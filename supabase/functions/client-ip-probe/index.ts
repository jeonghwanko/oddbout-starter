// Temporary probe (deploy, run scripts/probe-client-ip.mjs, then delete the function). It shows a caller only
// the two address headers of their own request, so the operator can see which one a client can spoof.
// It stores nothing and uses no database or secret.
Deno.serve(request =>
  Response.json(
    {
      cfConnectingIp: request.headers.get('cf-connecting-ip'),
      forwardedFor: request.headers.get('x-forwarded-for'),
    },
    { headers: { 'cache-control': 'no-store' } },
  ),
);
