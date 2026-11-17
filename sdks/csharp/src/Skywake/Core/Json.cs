using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Skywake;

internal static class Json
{
    internal static readonly JsonSerializerOptions Read = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) },
    };

    internal static readonly JsonSerializerOptions Write = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) },
    };

    internal static JsonNode? Node(object? value) => value switch
    {
        null => null,
        JsonNode node => node.DeepClone(),
        _ => JsonSerializer.SerializeToNode(value, value.GetType(), Write),
    };

    internal static JsonObject Object(params (string Name, object? Value)[] fields)
    {
        var body = new JsonObject();
        foreach (var (name, value) in fields)
        {
            if (value is not null)
            {
                body[name] = Node(value);
            }
        }
        return body;
    }

    internal static byte[] Bytes(object? value) => JsonSerializer.SerializeToUtf8Bytes(value, Write);

    internal static T Parse<T>(byte[] bytes) => JsonSerializer.Deserialize<T>(bytes, Read)!;
}
