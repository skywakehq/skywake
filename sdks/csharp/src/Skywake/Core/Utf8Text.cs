using System.Text;

namespace Skywake;

internal static class Utf8Text
{
    private static readonly UTF8Encoding Strict = new(false, true);

    internal static byte[] Encode(string text) => Encoding.UTF8.GetBytes(text);

    internal static string? AsText(byte[] bytes)
    {
        string text;
        try
        {
            text = Strict.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
        return JsonLength(text) <= (bytes.Length + 2L) / 3 * 4 + 2 ? text : null;
    }

    private static long JsonLength(string text)
    {
        long length = 2;
        foreach (var c in text)
        {
            length += c switch
            {
                '"' or '\\' or '\b' or '\f' or '\n' or '\r' or '\t' => 2,
                < ' ' => 6,
                < (char)0x80 => 1,
                < (char)0x800 => 2,
                _ when char.IsSurrogate(c) => 2,
                _ => 3,
            };
        }
        return length;
    }
}
