//! `s3-proxy`: passes every request to object storage unchanged and reports it, with optional fixed delays.

mod http;

use std::io::{self, Write};
use std::time::Duration;

use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use http::{copy_body, header, read_head, without_header};

const BUFFER: usize = 1 << 18;

#[derive(Clone, Copy)]
pub struct Delays {
    pub read: Duration,
    pub write: Duration,
}

pub async fn run(upstream: String, delays: Delays) -> io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    println!("listening {}", listener.local_addr()?.port());
    loop {
        let (client, _) = listener.accept().await?;
        let upstream = upstream.clone();
        tokio::spawn(async move {
            let _ = serve(client, &upstream, delays).await;
        });
    }
}

async fn serve(client: TcpStream, upstream: &str, delays: Delays) -> io::Result<()> {
    let server = TcpStream::connect(upstream).await?;
    client.set_nodelay(true)?;
    server.set_nodelay(true)?;
    let (client_read, mut client_write) = client.into_split();
    let (server_read, mut server_write) = server.into_split();
    let mut client_read = BufReader::with_capacity(BUFFER, client_read);
    let mut server_read = BufReader::with_capacity(BUFFER, server_read);

    while let Some(mut request) = read_head(&mut client_read).await? {
        let arrived = monotonic();
        let mut words = request.split(' ');
        let (method, target) = (
            words.next().unwrap_or("").to_string(),
            words.next().unwrap_or("").to_string(),
        );
        if header(&request, "expect")
            .is_some_and(|value| value.eq_ignore_ascii_case("100-continue"))
        {
            request = without_header(&request, "expect");
            client_write
                .write_all(b"HTTP/1.1 100 Continue\r\n\r\n")
                .await?;
        }
        let latency = match method.as_str() {
            "PUT" | "POST" => delays.write,
            _ => delays.read,
        };
        if !latency.is_zero() {
            tokio::time::sleep(latency).await;
        }
        server_write.write_all(request.as_bytes()).await?;
        let sent = copy_body(&mut client_read, &mut server_write, &request, false).await?;

        let response = read_head(&mut server_read).await?.ok_or_else(|| {
            io::Error::new(io::ErrorKind::UnexpectedEof, "S3 closed the connection")
        })?;
        client_write.write_all(response.as_bytes()).await?;
        let status: u16 = response
            .split(' ')
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let received = if method == "HEAD" || status == 204 || status == 304 {
            0
        } else {
            copy_body(&mut server_read, &mut client_write, &response, true).await?
        };
        report(arrived, &method, &target, sent, received, status);
    }
    Ok(())
}

fn report(arrived: f64, method: &str, target: &str, sent: u64, received: u64, status: u16) {
    let method = if method == "GET" && target.contains("list-type") {
        "LIST"
    } else {
        method
    };
    let path = target.split('?').next().unwrap_or("");
    let key = path
        .trim_start_matches('/')
        .split_once('/')
        .map_or("", |(_, key)| key);
    let key = if key.is_empty() { "-" } else { key };
    let line = format!("{arrived:.6} {method} {key} {sent} {received} {status}\n");
    let _ = io::stdout().lock().write_all(line.as_bytes());
}

fn monotonic() -> f64 {
    let mut now = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `now` is a valid timespec for the call to write into.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    now.tv_sec as f64 + now.tv_nsec as f64 / 1e9
}
