namespace Skywake;

public readonly struct FileContent
{
    private readonly string? _text;
    private readonly byte[]? _bytes;

    private FileContent(string? text, byte[]? bytes)
    {
        _text = text;
        _bytes = bytes;
    }

    public static implicit operator FileContent(string text) => new(text, null);

    public static implicit operator FileContent(byte[] bytes) => new(null, bytes);

    internal string? Text => _text;

    internal byte[] Bytes => _bytes ?? Utf8Text.Encode(_text ?? "");
}
