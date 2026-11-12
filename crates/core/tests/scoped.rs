//! `skywake://namespace` against a local stand-in for the API and S3.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use skywake_core::{Hash, Objects, open_store};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Default)]
struct Seen {
    grants: Vec<(String, String, String)>,
    signed: Vec<String>,
}

async fn serve(listener: TcpListener, seen: Arc<Mutex<Seen>>) {
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    loop {
        let (socket, _) = listener.accept().await.unwrap();
        let (seen, endpoint) = (seen.clone(), endpoint.clone());
        tokio::spawn(async move { answer(socket, seen, endpoint).await });
    }
}

async fn answer(mut socket: TcpStream, seen: Arc<Mutex<Seen>>, endpoint: String) {
    let mut request = Vec::new();
    let mut buffer = [0; 4096];
    let head_end = loop {
        let read = socket.read(&mut buffer).await.unwrap();
        if read == 0 {
            return;
        }
        request.extend_from_slice(&buffer[..read]);
        if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let head = String::from_utf8_lossy(&request[..head_end]).to_string();
    let header = |name: &str| {
        head.lines()
            .find_map(|line| {
                let (key, value) = line.split_once(':')?;
                key.eq_ignore_ascii_case(name)
                    .then(|| value.trim().to_string())
            })
            .unwrap_or_default()
    };
    let length: usize = header("content-length").parse().unwrap_or(0);
    while request.len() < head_end + length {
        let read = socket.read(&mut buffer).await.unwrap();
        request.extend_from_slice(&buffer[..read]);
    }
    let body = String::from_utf8_lossy(&request[head_end..]).to_string();
    let path = head.split(' ').nth(1).unwrap_or_default().to_string();

    let (status, reply) = if path.starts_with("/v1/namespaces/") {
        let mut seen = seen.lock().unwrap();
        seen.grants
            .push((path.clone(), header("authorization"), body));
        let n = seen.grants.len();
        if path.contains("closed") {
            ("501 Not Implemented", r#"{"error":"no sts"}"#.to_string())
        } else {
            let life = if n == 1 { 0 } else { 3600 };
            let expires = chrono::Utc::now() + Duration::from_secs(life);
            let grant = serde_json::json!({
                "store": "s3://bucket/tenants/a",
                "region": "us-east-1",
                "endpoint": endpoint,
                "accessKeyId": format!("AKID{n}"),
                "secretAccessKey": "secret",
                "sessionToken": "token",
                "expiresAt": expires.to_rfc3339(),
                "access": "write",
            });
            ("200 OK", grant.to_string())
        }
    } else {
        seen.lock().unwrap().signed.push(header("authorization"));
        ("404 Not Found", String::new())
    };
    let response = format!(
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
        reply.len()
    );
    socket.write_all(response.as_bytes()).await.unwrap();
}

#[tokio::test]
async fn scoped_credentials_come_from_the_api_and_are_not_renewed_before_every_request() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Seen::default()));
    tokio::spawn(serve(listener, seen.clone()));
    unsafe {
        std::env::set_var("SKYWAKE_API_URL", &url);
        std::env::set_var("SKYWAKE_API_KEY", "sk_test_key");
    }

    let objects = Objects::new(open_store("skywake://team/a").unwrap());
    for _ in 0..2 {
        let missing = objects.get_chunk(Hash::of(b"x")).await.unwrap_err();
        assert!(missing.to_string().contains("not found"), "{missing}");
    }
    {
        let seen = seen.lock().unwrap();
        let (path, auth, body) = &seen.grants[0];
        assert_eq!(path, "/v1/namespaces/team%2Fa/credentials");
        assert_eq!(auth, "Bearer sk_test_key");
        assert!(body.contains(r#""access":"write""#), "{body}");
        assert_eq!(seen.grants.len(), 1, "asked the API again");
        assert_eq!(seen.signed.len(), 2);
        for signed in &seen.signed {
            assert!(signed.contains("Credential=AKID1/"), "{signed}");
        }
    }

    let closed = Objects::new(open_store("skywake://closed").unwrap());
    let refused = closed.get_chunk(Hash::of(b"x")).await.unwrap_err();
    assert!(
        refused
            .to_string()
            .contains("cannot grant scoped credentials"),
        "{refused}"
    );
}
