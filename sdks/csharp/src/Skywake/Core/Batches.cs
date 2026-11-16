namespace Skywake;

internal static class Batches
{
    internal static IEnumerable<List<T>> Split<T>(IEnumerable<T> items, int count, long bytes, Func<T, long> weigh)
    {
        var batch = new List<T>();
        long size = 0;
        foreach (var item in items)
        {
            var weight = weigh(item);
            if (batch.Count == count || (batch.Count > 0 && size + weight > bytes))
            {
                yield return batch;
                batch = new List<T>();
                size = 0;
            }
            batch.Add(item);
            size += weight;
        }
        if (batch.Count > 0)
        {
            yield return batch;
        }
    }
}
