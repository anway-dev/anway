const express = require('express');
const app = express();
app.use(express.json());
const PORT = 3012, SERVICE = 'checkout-api';
let crashed = false;
let reqSuccess = 0, reqError = 0;
setInterval(() => {
  if (!crashed) { crashed = true; console.log(JSON.stringify({level:'error',service:SERVICE,msg:'crash loop start'}));
    setTimeout(() => { console.log(JSON.stringify({level:'info',service:SERVICE,msg:'restarting'})); crashed = false; }, 30000); }
}, 180000 + Math.random() * 60000);
app.get('/health', (_r, res) => { if (crashed) return res.status(503).json({status:'down'}); reqSuccess++; res.json({status:'ok',service:SERVICE}); });
app.get('/metrics', (_r, res) => {
  res.set('Content-Type','text/plain');
  res.send(['http_requests_total{service="'+SERVICE+'",method="POST",status_code="200"} '+reqSuccess,'http_requests_total{service="'+SERVICE+'",method="POST",status_code="500"} '+reqError,'http_request_duration_seconds{service="'+SERVICE+'",quantile="0.5"} 0.055','http_request_duration_seconds{service="'+SERVICE+'",quantile="0.99"} 0.421','error_rate{service="'+SERVICE+'"} '+(crashed?0.8:0.2)].join('\n'));
});
app.post('/checkout', (req, res) => {
  if (crashed) { reqError++; return res.status(503).json({error:'service_unavailable'}); }
  if (Math.random()<0.2) { reqError++; return res.status(500).json({error:'checkout_failed'}); }
  reqSuccess++;
  console.log(JSON.stringify({level:'info',service:SERVICE,msg:'checkout',items:req.body?.items}));
  res.json({status:'ok',orderId:Math.random().toString(36).slice(2)});
});
app.listen(PORT, () => console.log(JSON.stringify({level:'info',service:SERVICE,msg:'started',port:PORT})));
