//! What the cache server tests share: the token, and a server on a free local port.

#![allow(dead_code)]

use skywake_cache::Node;
use tokio::net::TcpListener;

pub const TOKEN: &str = "test-token";

pub async fn listen() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    (listener, url)
}

pub async fn serve(node: Node) -> String {
    let (listener, url) = listen().await;
    tokio::spawn(skywake_cache::serve(listener, node));
    url
}
