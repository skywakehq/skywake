//! The socket between the daemon and a helper, which carries a file with the answer.

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::time::Duration;

pub(super) fn socket_pair() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut fds = [0; 2];
    let kind = libc::SOCK_SEQPACKET | libc::SOCK_CLOEXEC;
    // SAFETY: `fds` has room for the two descriptors.
    if unsafe { libc::socketpair(libc::AF_UNIX, kind, 0, fds.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: both are new descriptors that nothing else owns.
    Ok(unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) })
}

pub(super) fn wait_readable(socket: &OwnedFd, timeout: Duration) -> io::Result<()> {
    let mut poll = libc::pollfd {
        fd: socket.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    loop {
        // SAFETY: `poll` is valid for the call.
        match unsafe { libc::poll(&mut poll, 1, timeout.as_millis() as libc::c_int) } {
            0 => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "the helper took too long",
                ));
            }
            found if found > 0 => return Ok(()),
            _ if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => continue,
            _ => return Err(io::Error::last_os_error()),
        }
    }
}

type Control = [u64; 4];

pub(super) fn send(socket: &OwnedFd, bytes: &[u8], file: Option<RawFd>) -> io::Result<()> {
    let mut iov = libc::iovec {
        iov_base: bytes.as_ptr() as *mut _,
        iov_len: bytes.len(),
    };
    let mut control: Control = [0; 4];
    // SAFETY: an all-zero msghdr is a valid empty one.
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut iov;
    message.msg_iovlen = 1;
    if let Some(fd) = file {
        message.msg_control = control.as_mut_ptr().cast();
        // SAFETY: CMSG_SPACE only computes a size.
        message.msg_controllen = unsafe { libc::CMSG_SPACE(4) } as _;
        // SAFETY: `control` has room for one header and one descriptor.
        unsafe {
            let header = libc::CMSG_FIRSTHDR(&message);
            (*header).cmsg_level = libc::SOL_SOCKET;
            (*header).cmsg_type = libc::SCM_RIGHTS;
            (*header).cmsg_len = libc::CMSG_LEN(4) as _;
            libc::CMSG_DATA(header).cast::<RawFd>().write_unaligned(fd);
        }
    }
    // SAFETY: every pointer in `message` is valid during the call.
    if unsafe { libc::sendmsg(socket.as_raw_fd(), &message, 0) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub(super) fn recv(socket: &OwnedFd, max: usize) -> io::Result<(Vec<u8>, Option<OwnedFd>)> {
    let mut bytes = vec![0u8; max];
    let mut iov = libc::iovec {
        iov_base: bytes.as_mut_ptr().cast(),
        iov_len: bytes.len(),
    };
    let mut control: Control = [0; 4];
    // SAFETY: an all-zero msghdr is a valid empty one.
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut iov;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = std::mem::size_of::<Control>() as _;
    // SAFETY: every pointer in `message` is valid during the call.
    let read = unsafe { libc::recvmsg(socket.as_raw_fd(), &mut message, libc::MSG_CMSG_CLOEXEC) };
    if read < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: recvmsg filled in the control part it reports.
    let file = unsafe {
        let header = libc::CMSG_FIRSTHDR(&message);
        let rights = !header.is_null()
            && (*header).cmsg_level == libc::SOL_SOCKET
            && (*header).cmsg_type == libc::SCM_RIGHTS;
        rights
            .then(|| OwnedFd::from_raw_fd(libc::CMSG_DATA(header).cast::<RawFd>().read_unaligned()))
    };
    if read == 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "the helper ended without an answer",
        ));
    }
    if message.msg_flags & (libc::MSG_TRUNC | libc::MSG_CTRUNC) != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "the message was too long",
        ));
    }
    bytes.truncate(read as usize);
    Ok((bytes, file))
}
