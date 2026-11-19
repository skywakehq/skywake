using System.Collections.Specialized;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Web;
using Xunit;

namespace Skywake.Tests;

public sealed record Seen(string Method, string Path, NameValueCollection Query, IReadOnlyDictionary<string, string> Headers, byte[] Body)
{
    public JsonNode? Json => Body.Length == 0 ? null : JsonNode.Parse(Body);
}

public sealed record Reply(int Status = 200, object? Body = null, IReadOnlyDictionary<string, string>? Headers = null);

public sealed class FakeApi : HttpMessageHandler
{
    private readonly Func<Seen, int, Reply> _answer;

    public FakeApi(Func<Seen, int, Reply> answer) => _answer = answer;

    public List<Seen> Seen { get; } = new();

    public SkywakeClient Client(SkywakeOptions? options = null) =>
        new((options ?? new SkywakeOptions()) with { Url = "http://api.test", Key = "k", Backoff = TimeSpan.FromMilliseconds(1), Handler = this });

    public static Reply Failure(int status, string code, object? extra = null)
    {
        var error = new JsonObject { ["code"] = code, ["message"] = "nope", ["hint"] = null, ["request_id"] = "req-1" };
        foreach (var (name, value) in JsonSerializer.SerializeToNode(extra ?? new { })!.AsObject())
        {
            error[name] = value?.DeepClone();
        }
        return new Reply(status, new JsonObject { ["error"] = error });
    }

    public static void Same(object want, JsonNode? got) =>
        Assert.True(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(want), got), $"got {got?.ToJsonString()}");

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content is null ? Array.Empty<byte>() : await request.Content.ReadAsByteArrayAsync(ct);
        var headers = request.Headers.ToDictionary(header => header.Key.ToLowerInvariant(), header => string.Join(",", header.Value));
        var uri = request.RequestUri!;
        var seen = new Seen(request.Method.Method, uri.AbsolutePath, HttpUtility.ParseQueryString(uri.Query), headers, body);
        int count;
        lock (Seen)
        {
            Seen.Add(seen);
            count = Seen.Count;
        }
        return Response(_answer(seen, count));
    }

    private static HttpResponseMessage Response(Reply reply)
    {
        var response = new HttpResponseMessage((HttpStatusCode)reply.Status);
        var text = reply.Body is null ? "" : JsonSerializer.Serialize(reply.Body);
        response.Content = new StringContent(text, Encoding.UTF8, "application/json");
        foreach (var (name, value) in reply.Headers ?? new Dictionary<string, string>())
        {
            response.Headers.TryAddWithoutValidation(name, value);
        }
        return response;
    }
}
