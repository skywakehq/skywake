namespace Skywake;

internal sealed record ErrorDetails(int Status, string? Code, string Message, string? Hint, string? RequestId, string? Path);

public class SkywakeException : Exception
{
    internal SkywakeException(ErrorDetails details)
        : base(details.Hint is null ? details.Message : $"{details.Message}; {details.Hint}")
    {
        Status = details.Status;
        Code = details.Code;
        Hint = details.Hint;
        RequestId = details.RequestId;
        Path = details.Path;
    }

    public int Status { get; }

    public string? Code { get; }

    public string? Hint { get; }

    public string? RequestId { get; }

    public string? Path { get; }
}

public class AuthException : SkywakeException
{
    internal AuthException(ErrorDetails details) : base(details) { }
}

public class PermissionException : SkywakeException
{
    internal PermissionException(ErrorDetails details) : base(details) { }
}

public class NotFoundException : SkywakeException
{
    internal NotFoundException(ErrorDetails details) : base(details) { }
}

public class ConflictException : SkywakeException
{
    internal ConflictException(ErrorDetails details) : base(details) { }
}

public class MergeConflictException : ConflictException
{
    internal MergeConflictException(ErrorDetails details, IReadOnlyList<string> conflicts) : base(details) =>
        Conflicts = conflicts;

    public IReadOnlyList<string> Conflicts { get; }
}

public class RateLimitedException : SkywakeException
{
    internal RateLimitedException(ErrorDetails details, TimeSpan? retryAfter) : base(details) => RetryAfter = retryAfter;

    public TimeSpan? RetryAfter { get; }
}

public class ServerException : SkywakeException
{
    internal ServerException(ErrorDetails details) : base(details) { }
}

public class InvalidRequestException : SkywakeException
{
    internal InvalidRequestException(ErrorDetails details) : base(details) { }
}
