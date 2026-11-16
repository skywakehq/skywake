namespace Skywake;

internal static class Concurrent
{
    internal const int Limit = 8;

    internal static async Task<TResult[]> MapAsync<T, TResult>(
        IReadOnlyList<T> items, Func<T, CancellationToken, Task<TResult>> work, CancellationToken ct)
    {
        var results = new TResult[items.Count];
        await RunAsync(Enumerable.Range(0, items.Count).ToList(), async (i, token) =>
            results[i] = await work(items[i], token).ConfigureAwait(false), ct).ConfigureAwait(false);
        return results;
    }

    internal static Task RunAsync<T>(IReadOnlyList<T> items, Func<T, CancellationToken, Task> work, CancellationToken ct)
    {
        var options = new ParallelOptions { MaxDegreeOfParallelism = Limit, CancellationToken = ct };
        return Parallel.ForEachAsync(items, options, async (item, token) => await work(item, token).ConfigureAwait(false));
    }
}
