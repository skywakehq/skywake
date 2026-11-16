package skywake

import "context"

func fork(ctx context.Context, t *transport, path, name, from string, options ForkOptions) error {
	body := compact(map[string]any{"name": name, "from": from, "at": options.At})
	return t.post(ctx, path+"/branches", body, nil, nil)
}

func destroy(ctx context.Context, t *transport, path, branch string) error {
	if branch == Main {
		return t.delete(ctx, path)
	}
	return t.delete(ctx, path+"/branches/"+segment(branch))
}
