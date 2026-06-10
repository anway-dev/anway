const express = require('express');
const app = express();
app.use(express.json());

const PORT = 3010;
const SERVICE = 'payments-api';
let errorRate = 0.15;
let inSpike = false;
let reqSuccess = 0, reqError = 0;

// Spike error rate every ~90s for 20s
setInterval(() => {
  if (!inSpike) {
    inSpike = true;
    errorRate = 0.6;
    console.log(JSON.stringify({ level: 'warn', service: SERVICE, msg: 'error rate spike start', errorRate }));
    setTimeout(() => { errorRate = 0.15; inSpike = false; }, 20000);
  }
}, 90000 + Math.random() * 30000);

app.get('/health', (_req, res) => { reqSuccess++; res.json({ status: 'ok', service: SERVICE }); });
app.get('/metrics', (_req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send([
    '# HELP http_requests_total Total HTTP requests',
    '# TYPE http_requests_total counter',
    'http_requests_total{service="' + SERVICE + '",method="GET",status_code="200"} ' + reqSuccess,
    'http_requests_total{service="' + SERVICE + '",method="POST",status_code="500"} ' + reqError,
    '# HELP http_request_duration_seconds Request duration summary',
    '# TYPE http_request_duration_seconds summary',
    'http_request_duration_seconds{service="' + SERVICE + '",quantile="0.5"} 0.032',
    'http_request_duration_seconds{service="' + SERVICE + '",quantile="0.99"} 0.245',
    '# HELP error_rate Current error rate',
    '# TYPE error_rate gauge',
    'error_rate{service="' + SERVICE + '"} ' + errorRate,
  ].join('\n'));
});
app.post('/pay', (req, res) => {
  console.log(JSON.stringify({ level: 'info', service: SERVICE, msg: 'payment request', amount: req.body?.amount }));
  if (Math.random() < errorRate) {
    reqError++;
    console.log(JSON.stringify({ level: 'error', service: SERVICE, msg: 'payment failed', error: 'insufficient_funds' }));
    return res.status(500).json({ error: 'payment_failed' });
  }
  reqSuccess++;
  res.json({ status: 'ok', transactionId: Math.random().toString(36).slice(2) });
});

app.listen(PORT, () => console.log(JSON.stringify({ level: 'info', service: SERVICE, msg: 'started', port: PORT })));
