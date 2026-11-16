using System.Runtime.CompilerServices;

namespace Skywake;

internal sealed record Page<T>(IReadOnlyList<T> Data, string? Next);

internal static class Paging
{
    internal static async IAsyncEnumerable<T> Pages<T>(
        Func<string?, CancellationToken, Task<Page<T>>> load,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        string? cursor = null;
        while (true)
        {
            var page = await load(cursor, ct).ConfigureAwait(false);
            foreach (var item in page.Data)
            {
                yield return item;
            }
            if (string.IsNullOrEmpty(page.Next))
            {
                yield break;
            }
            cursor = page.Next;
        }
    }

    internal static async Task<IReadOnlyList<T>> CollectAsync<T>(this IAsyncEnumerable<T> items, CancellationToken ct)
    {
        var all = new List<T>();
        await foreach (var item in items.WithCancellation(ct).ConfigureAwait(false))
        {
            all.Add(item);
        }
        return all;
    }
}
