//! HTTP/1.1 framing: reading a head, and copying a body as it arrives, by length or in chunks.

use std::io;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

pub(super) async fn read_head<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> io::Result<Option<String>> {
    let mut head = String::new();
    loop {
        let read = reader.read_line(&mut head).await?;
        if read == 0 {
            return if head.is_empty() {
                Ok(None)
            } else {
                Err(io::ErrorKind::UnexpectedEof.into())
            };
        }
        if head.ends_with("\r\n\r\n") {
            return Ok(Some(head));
        }
    }
}

pub(super) async fn copy_body<R, W>(
    reader: &mut BufReader<R>,
    writer: &mut W,
    head: &str,
    response: bool,
) -> io::Result<u64>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    if header(head, "transfer-encoding").is_some_and(|value| value.contains("chunked")) {
        return copy_chunks(reader, writer).await;
    }
    match header(head, "content-length") {
        Some(length) => {
            let length = length
                .parse()
                .map_err(|_| io::Error::other("bad Content-Length"))?;
            let copied = tokio::io::copy_buf(&mut (&mut *reader).take(length), writer).await?;
            if copied < length {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            Ok(copied)
        }
        None if response => tokio::io::copy_buf(reader, writer).await,
        None => Ok(0),
    }
}

async fn copy_chunks<R, W>(reader: &mut BufReader<R>, writer: &mut W) -> io::Result<u64>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut total = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        writer.write_all(line.as_bytes()).await?;
        let size = u64::from_str_radix(line.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| io::Error::other("bad chunk size"))?;
        if size == 0 {
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).await?;
                writer.write_all(line.as_bytes()).await?;
                if line == "\r\n" || line.is_empty() {
                    return Ok(total);
                }
            }
        }
        tokio::io::copy_buf(&mut (&mut *reader).take(size + 2), writer).await?;
        total += size;
    }
}

pub(super) fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.split("\r\n").skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

pub(super) fn without_header(head: &str, name: &str) -> String {
    head.split_inclusive("\r\n")
        .filter(|line| {
            line.split_once(':')
                .is_none_or(|(key, _)| !key.trim().eq_ignore_ascii_case(name))
        })
        .collect()
}
