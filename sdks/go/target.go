package skywake

import (
	"fmt"
	"reflect"
)

func targetOf(target any) (map[string]any, error) {
	if filter, ok := target.(map[string]any); ok {
		if inner, ok := filter["filter"]; ok && len(filter) == 1 {
			return map[string]any{"filter": inner}, nil
		}
		return map[string]any{"filter": filter}, nil
	}
	switch reflect.ValueOf(target).Kind() {
	case reflect.String, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float64:
		return map[string]any{"id": target}, nil
	case reflect.Slice, reflect.Array:
		return map[string]any{"ids": target}, nil
	}
	return nil, fmt.Errorf("skywake: a target is an id, a slice of ids or a Filter, not %T", target)
}
