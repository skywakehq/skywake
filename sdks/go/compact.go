package skywake

import "reflect"

func compact(fields map[string]any) map[string]any {
	out := map[string]any{}
	for name, value := range fields {
		if value != nil && !reflect.ValueOf(value).IsZero() {
			out[name] = value
		}
	}
	return out
}
