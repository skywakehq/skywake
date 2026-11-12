using System.Text.Json;
using System.Text.Json.Serialization;

namespace Skywake;

/// <summary>How the SDK's types are written to and read from the API's JSON.</summary>
internal static class JsonDefaults
{
    // Fields left null are not sent, so the server uses its defaults. A null in a dictionary
    // is sent: in a patch it removes an attribute.
    internal static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new PlainObjectConverter() },
    };
}
