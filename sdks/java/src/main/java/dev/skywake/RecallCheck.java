package dev.skywake;

/** Asks how many of the true nearest documents queries find. */
public final class RecallCheck {
    private String column;
    private Integer queries;
    private Integer topK;
    private Double recall;
    private Object filter;

    public RecallCheck column(String column) {
        this.column = column;
        return this;
    }

    public RecallCheck queries(int queries) {
        this.queries = queries;
        return this;
    }

    public RecallCheck topK(int topK) {
        this.topK = topK;
        return this;
    }

    public RecallCheck recall(double recall) {
        this.recall = recall;
        return this;
    }

    public RecallCheck filter(Object filter) {
        this.filter = filter;
        return this;
    }
}
