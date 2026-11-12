//! Serves a [`BranchFs`] to a VM over virtio-fs.

mod fs;

use std::io;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::thread::JoinHandle;

use fuse_backend_rs::api::server::Server;
use fuse_backend_rs::transport::{Reader, VirtioFsWriter};
use tokio::runtime::Handle;
use vhost::vhost_user::{
    Error as VhostUserError, VhostUserProtocolFeatures, VhostUserVirtioFeatures,
};
use vhost_user_backend::{Error, VhostUserBackend, VhostUserDaemon, VringRwLock, VringT};
use virtio_queue::QueueT;
use vm_memory::{GuestAddressSpace, GuestMemoryAtomic, GuestMemoryMmap};
use vmm_sys_util::epoll::EventSet;

use super::Fsyncs;
use crate::BranchFs;
use fs::VmFs;

const QUEUES: usize = 2;
const QUEUE_SIZE: usize = 1024;

const VIRTIO_F_VERSION_1: u64 = 1 << 32;

type Memory = GuestMemoryAtomic<GuestMemoryMmap>;

pub struct VmSession {
    socket: PathBuf,
    thread: Option<JoinHandle<()>>,
}

pub fn serve_vm(fs: Arc<BranchFs>, socket: &Path, fsyncs: Fsyncs) -> io::Result<VmSession> {
    let _ = std::fs::remove_file(socket);
    serve_vm_on(fs, UnixListener::bind(socket)?, socket, fsyncs)
}

pub fn serve_vm_on(
    fs: Arc<BranchFs>,
    listener: UnixListener,
    socket: &Path,
    fsyncs: Fsyncs,
) -> io::Result<VmSession> {
    let memory = GuestMemoryAtomic::new(GuestMemoryMmap::new());
    let backend = Backend {
        server: Arc::new(Server::new(Arc::new(VmFs::new(fs, fsyncs)))),
        memory: Arc::new(RwLock::new(memory.clone())),
        runtime: Handle::current(),
    };
    let mut daemon = VhostUserDaemon::new("skywake".into(), backend, memory)
        .map_err(|error| io::Error::other(format!("{error:?}")))?;
    let mut listener = vhost::vhost_user::Listener::from(listener);
    let path = socket.display().to_string();
    let thread = std::thread::Builder::new()
        .name("skywake-vm".into())
        .spawn(
            move || match daemon.start(&mut listener).and_then(|()| daemon.wait()) {
                Ok(()) | Err(Error::HandleRequest(VhostUserError::Disconnected)) => {}
                Err(error) => tracing::error!(socket = %path, ?error, "virtio-fs stopped"),
            },
        )?;
    Ok(VmSession {
        socket: socket.to_path_buf(),
        thread: Some(thread),
    })
}

impl VmSession {
    pub fn stop(mut self) {
        if let Some(thread) = self.thread.take()
            && !thread.is_finished()
        {
            let _ = UnixStream::connect(&self.socket);
        }
        let _ = std::fs::remove_file(&self.socket);
    }
}

#[derive(Clone)]
struct Backend {
    server: Arc<Server<Arc<VmFs>>>,
    memory: Arc<RwLock<Memory>>,
    runtime: Handle,
}

impl VhostUserBackend for Backend {
    type Bitmap = ();
    type Vring = VringRwLock;

    fn num_queues(&self) -> usize {
        QUEUES
    }

    fn max_queue_size(&self) -> usize {
        QUEUE_SIZE
    }

    fn features(&self) -> u64 {
        VIRTIO_F_VERSION_1 | VhostUserVirtioFeatures::PROTOCOL_FEATURES.bits()
    }

    fn protocol_features(&self) -> VhostUserProtocolFeatures {
        VhostUserProtocolFeatures::MQ
    }

    fn set_event_idx(&self, _enabled: bool) {}

    fn update_memory(&self, memory: Memory) -> io::Result<()> {
        *self.memory.write().unwrap() = memory;
        Ok(())
    }

    fn handle_event(
        &self,
        queue: u16,
        events: EventSet,
        vrings: &[VringRwLock],
        _thread: usize,
    ) -> io::Result<()> {
        if events != EventSet::IN {
            return Err(io::Error::other(format!("unexpected events {events:?}")));
        }
        let vring = &vrings[queue as usize];
        let memory = self.memory.read().unwrap().memory();
        while let Some(chain) = vring
            .get_mut()
            .get_queue_mut()
            .pop_descriptor_chain(memory.clone())
        {
            let (server, vring, memory) = (self.server.clone(), vring.clone(), memory.clone());
            self.runtime.spawn_blocking(move || {
                let head = chain.head_index();
                let answered = Reader::from_descriptor_chain(&*memory, chain.clone())
                    .and_then(|reader| Ok((reader, VirtioFsWriter::new(&*memory, chain)?)))
                    .map_err(io::Error::other)
                    .and_then(|(reader, writer)| {
                        server
                            .handle_message(reader, writer.into(), None, None)
                            .map_err(io::Error::other)
                    });
                let written = answered.unwrap_or_else(|error| {
                    tracing::warn!(%error, "virtio-fs request failed");
                    0
                });
                if vring.add_used(head, written as u32).is_ok() {
                    let _ = vring.signal_used_queue();
                }
            });
        }
        Ok(())
    }
}
