using System.Text.Json.Nodes;

namespace Skywake;

public sealed class Target
{
    private readonly string _field;
    private readonly object _value;

    private Target(string field, object value)
    {
        _field = field;
        _value = value;
    }

    public static Target Id(object id) => new("id", id);

    public static Target Ids(IEnumerable<object> ids) => new("ids", ids.ToList());

    public static Target Where(object filter) => new("filter", filter);

    public static implicit operator Target(string id) => Id(id);

    public static implicit operator Target(long id) => Id(id);

    public static implicit operator Target(string[] ids) => Ids(ids);

    public static implicit operator Target(long[] ids) => Ids(ids.Cast<object>());

    public static implicit operator Target(int[] ids) => Ids(ids.Cast<object>());

    internal JsonObject Body() => Json.Object((_field, _value));
}
