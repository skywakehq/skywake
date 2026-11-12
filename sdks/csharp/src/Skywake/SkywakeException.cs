namespace Skywake;

/// <summary>
/// An error answer from the API. <see cref="Code"/> says what kind of error it is, such as
/// "not_found" or "rate_limited". Quote <see cref="RequestId"/> when you report a bug. For an
/// invalid request, <see cref="Path"/> is the JSON path of the field that is wrong.
/// </summary>
public sealed class SkywakeException : Exception
{
    public SkywakeException(int status, string message, string? code = null, string? requestId = null, string? path = null)
        : base(message)
    {
        Status = status;
        Code = code;
        RequestId = requestId;
        Path = path;
    }

    public int Status { get; }

    public string? Code { get; }

    public string? RequestId { get; }

    public string? Path { get; }

    public override string ToString() => $"{Status}: {Message}";
}
