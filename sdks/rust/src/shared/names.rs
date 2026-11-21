use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(transparent)]
pub struct Names(Vec<String>);

impl From<&str> for Names {
    fn from(name: &str) -> Self {
        Names(vec![name.to_string()])
    }
}

impl From<String> for Names {
    fn from(name: String) -> Self {
        Names(vec![name])
    }
}

impl<S: Into<String>> From<Vec<S>> for Names {
    fn from(names: Vec<S>) -> Self {
        Names(names.into_iter().map(Into::into).collect())
    }
}

impl<S: Into<String>, const N: usize> From<[S; N]> for Names {
    fn from(names: [S; N]) -> Self {
        Names(names.into_iter().map(Into::into).collect())
    }
}

impl Names {
    pub(crate) fn into_vec(self) -> Vec<String> {
        self.0
    }
}
