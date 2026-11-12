using System.Runtime.CompilerServices;

namespace Skywake;

/// <summary>Reads lists a page at a time.</summary>
internal static class Paging
{
    /// <summary>The most items a page of a list holds.</summary>
    internal const int Page = 1000;

    /// <summary>The query of one page: at most <paramref name="limit"/> items, from <paramref name="key"/>.</summary>
    internal static Dictionary<string, object> Query(int? limit, string name, string? key)
    {
        var query = new Dictionary<string, object>();
        if (limit is not null)
        {
            query["limit"] = limit;
        }
        if (key is not null)
        {
            query[name] = key;
        }
        return query;
    }

    /// <summary>The query of one page of a list keyed by name: at most <paramref name="limit"/> items, after <paramref name="after"/>.</summary>
    internal static Dictionary<string, object> After(int? limit, string? after) => Query(limit, "after", after);

    /// <summary>Every item of a list, asking for one page at a time until a short one.</summary>
    internal static async IAsyncEnumerable<T> Every<T>(
        Func<int, string?, CancellationToken, Task<IReadOnlyList<T>>> list,
        Func<T, string> key,
        [EnumeratorCancellation] CancellationToken ct)
    {
        string? after = null;
        while (true)
        {
            var items = await list(Page, after, ct).ConfigureAwait(false);
            foreach (var item in items)
            {
                yield return item;
            }
            if (items.Count < Page)
            {
                yield break;
            }
            after = key(items[^1]);
        }
    }
}
