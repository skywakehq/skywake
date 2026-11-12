using System.Text.Json;
using System.Text.Json.Serialization;

namespace Skywake;

/// <summary>
/// Reads JSON held in an <c>object</c> as plain .NET values: string, long, double, bool, null,
/// lists and dictionaries, rather than as JsonElement.
/// </summary>
internal sealed class PlainObjectConverter : JsonConverter<object>
{
    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.String:
                return reader.GetString();
            case JsonTokenType.Number:
                return reader.TryGetInt64(out var whole) ? whole : (object)reader.GetDouble();
            case JsonTokenType.True:
                return true;
            case JsonTokenType.False:
                return false;
            case JsonTokenType.StartArray:
                var list = new List<object?>();
                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                {
                    list.Add(Read(ref reader, typeToConvert, options));
                }
                return list;
            case JsonTokenType.StartObject:
                var map = new Dictionary<string, object?>();
                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    var name = reader.GetString()!;
                    reader.Read();
                    map[name] = Read(ref reader, typeToConvert, options);
                }
                return map;
            default:
                return null;
        }
    }

    public override void Write(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
    {
        var type = value.GetType();
        if (type == typeof(object))
        {
            writer.WriteStartObject();
            writer.WriteEndObject();
            return;
        }
        JsonSerializer.Serialize(writer, value, type, options);
    }
}
