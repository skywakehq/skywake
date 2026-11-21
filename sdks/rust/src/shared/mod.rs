pub(crate) mod batches;
pub(crate) mod bytes;
pub(crate) mod http;
pub(crate) mod names;
pub(crate) mod paging;
pub(crate) mod retry;
pub(crate) mod time;

macro_rules! awaitable {
    ($name:ident => $output:ty) => {
        impl<'a> std::future::IntoFuture for $name<'a> {
            type Output = $crate::Result<$output>;
            type IntoFuture = futures::future::BoxFuture<'a, Self::Output>;

            fn into_future(self) -> Self::IntoFuture {
                Box::pin(self.send())
            }
        }
    };
}

pub(crate) use awaitable;
