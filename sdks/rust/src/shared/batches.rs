pub(crate) struct Limits {
    pub count: usize,
    pub bytes: usize,
}

pub(crate) fn batches<T>(
    items: Vec<T>,
    limits: &Limits,
    weigh: impl Fn(&T) -> usize,
) -> Vec<Vec<T>> {
    let mut all = Vec::new();
    let mut batch = Vec::new();
    let mut size = 0;
    for item in items {
        let weight = weigh(&item);
        if batch.len() == limits.count || (!batch.is_empty() && size + weight > limits.bytes) {
            all.push(std::mem::take(&mut batch));
            size = 0;
        }
        batch.push(item);
        size += weight;
    }
    if !batch.is_empty() {
        all.push(batch);
    }
    all
}
