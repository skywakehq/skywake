{{- define "skywake.labels" -}}
app.kubernetes.io/name: skywake
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{- define "skywake.select" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "skywake.secret" -}}
valueFrom:
  secretKeyRef: { name: {{ .root.Values.secret }}, key: {{ .key }} }
{{- end }}

{{/* The bucket, for the API and the cache nodes. */}}
{{- define "skywake.store" -}}
- name: SKYWAKE_STORE
  value: {{ .Values.store | quote }}
- name: AWS_REGION
  value: {{ .Values.aws.region | quote }}
{{- with .Values.aws.endpoint }}
- name: AWS_ENDPOINT
  value: {{ . | quote }}
{{- if hasPrefix "http://" . }}
- name: AWS_ALLOW_HTTP
  value: "true"
{{- end }}
{{- end }}
{{- if .Values.aws.keysFromSecret }}
- name: AWS_ACCESS_KEY_ID
  {{- include "skywake.secret" (dict "root" . "key" "aws-access-key-id") | nindent 2 }}
- name: AWS_SECRET_ACCESS_KEY
  {{- include "skywake.secret" (dict "root" . "key" "aws-secret-access-key") | nindent 2 }}
{{- end }}
{{- end }}

{{/* Every cache node's address, comma separated. */}}
{{- define "skywake.cacheNodes" -}}
{{- $nodes := list }}
{{- range $i := until (int .Values.cache.replicas) }}
{{- $nodes = append $nodes (printf "http://%s-cache-%d.%s-cache:7070" $.Release.Name $i $.Release.Name) }}
{{- end }}
{{- join "," $nodes }}
{{- end }}

{{/* A component's image: its own `image`, or the published one for this chart's version. */}}
{{- define "skywake.image" -}}
{{- $values := index .root.Values .component -}}
{{- $tag := .root.Values.images.tag | default .root.Chart.AppVersion -}}
{{- $values.image | default (printf "%s/skywake-%s:%s" .root.Values.images.registry .component $tag) -}}
{{- end }}
