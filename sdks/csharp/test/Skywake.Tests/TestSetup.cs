using Xunit;
using Xunit.Abstractions;
using Xunit.Sdk;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Skywake.Tests;

public sealed class ByName : ITestCaseOrderer
{
    public IEnumerable<TTestCase> OrderTestCases<TTestCase>(IEnumerable<TTestCase> testCases)
        where TTestCase : ITestCase =>
        testCases.OrderBy(test => test.TestMethod.Method.Name, StringComparer.Ordinal);
}
