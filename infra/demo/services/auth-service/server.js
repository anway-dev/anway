const express = require('express');
const app = express();
app.use(express.json());
const PORT = 3011, SERVICE = 'auth-service';
let slowMode = false;
let reqSuccess = 0, reqError = 0;
setInterval(() => {
  if (!slowMode) { slowMode = true; console.log(JSON.stringify({level:'warn',service:SERVICE,msg:'latency spike start'}));
    setTimeout(() => { slowMode = false; }, 15000); }
}, 120000 + Math.random() * 30000);
app.get('/health', (_r, res) => { reqSuccess++; res.json({status:'ok',service:SERVICE}); });
app.get('/metrics', (_r, res) => {
  res.set('Content-Type','text/plain');
  res.send(['http_requests_total{service="'+SERVICE+'",method="POST",status_code="200"} '+reqSuccess,'http_requests_total{service="'+SERVICE+'",method="POST",status_code="500"} '+reqError,'http_request_duration_seconds{service="'+SERVICE+'",quantile="0.5"} 0.045','http_request_duration_seconds{service="'+SERVICE+'",quantile="0.99"} 0.312','error_rate{service="'+SERVICE+'"} 0.08'].join('\n'));
});
app.post('/login', (req, res) => {
  if (slowMode) { const d = 500+Math.random()*2000; reqSuccess++; setTimeout(() => res.json({status:'ok'}), d); return; }
  console.log(JSON.stringify({level:'info',service:SERVICE,msg:'login',user:req.body?.email}));
  if (Math.random()<0.08) { reqError++; return res.status(500).json({error:'auth_failed'}); }
  reqSuccess++;
  res.json({status:'ok',token:Math.random().toString(36).slice(2)});
});
app.listen(PORT, () => console.log(JSON.stringify({level:'info',service:SERVICE,msg:'started',port:PORT})));
