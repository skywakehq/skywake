curl -s "$SKYWAKE_URL/health"
echo

curl -s "$SKYWAKE_URL/v2/whoami" -H "authorization: Bearer $SKYWAKE_API_KEY"
echo

skywake whoami
