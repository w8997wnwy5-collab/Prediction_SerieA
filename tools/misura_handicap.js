/* L'handicap asiatico aggiunge qualcosa, o dice quello che gia' so?

   E' il mercato piu' liquido del mondo e la misura piu' precisa che esista di
   quanto una squadra sia data favorita. Sembra la cosa migliore a cui
   ancorarsi — e proprio per questo va provata invece che creduta.

   La domanda esatta: il modello, GIA' ancorato al 1X2, prevede bene chi copre
   la linea? Se si', l'handicap e' un altro modo di scrivere quello che ho gia',
   e aggiungerlo non porta niente. Se no, li' dentro c'e' informazione che il
   1X2 non da'.

   Il conto tiene conto dei RIMBORSI, che sono la parte delicata: "casa 0"
   rimborsa sul pareggio, "casa -0.25" ne rimborsa meta'. Una quota di 1.90 su
   una linea non dice la stessa cosa della stessa quota su un'altra, e
   trattarle uguali butterebbe via proprio quello che si e' venuti a prendere.

   uso: node tools/misura_handicap.js
*/
var fs=require('fs'), path=require('path');
var R='/home/user/Prediction_SerieA';
var M=require(path.join(R,'modello.js'));
var doc=JSON.parse(fs.readFileSync(path.join(R,'data','serie-a.json'),'utf8'));
var dati=M.prepara(doc.partite);
var st=(doc.stagioni||[]).slice().sort();
var da=(parseInt(st[Math.max(0,st.length-3)].slice(0,4),10))+'-08-01';
var res=M.campionaBacktest(dati,{da:da, refitOgniGiorni:3, iterazioni:110});
var idx={};
doc.partite.forEach(function(p){ idx[p.d+'|'+p.c+'|'+p.v]=p; });

var righe=[];
res.campioni.forEach(function(c){
  var p=idx[c.d+'|'+c.casa+'|'+c.via];
  if(!p || !p.qah || !p.q) return;
  var linea=p.qah[0];
  var lam=c.lamG, mu=c.muG;
  if(c.lamT!=null){ lam=0.65*c.lamG+0.35*c.lamT; mu=0.65*c.muG+0.35*c.muT; }
  var puro=M.probHandicap(M.matriceRisultati(lam,mu,c.rho,11), linea);
  var a=M.ancoraMercato(lam,mu,c.rho,{q:(p.qex||p.q), qou:p.qou, peso1x2:0.95, pesoOU:0.95});
  var anc=(a&&a.usato)?M.probHandicap(M.matriceRisultati(a.lam,a.mu,c.rho,11), linea):puro;
  var mer=M.daQuoteHandicap(p.qah);
  /* esito reale: casa copre, rimborso, o perde */
  var linee = Math.abs(linea*2-Math.round(linea*2))<1e-9 ? [linea] : [linea-0.25, linea+0.25];
  var v=0, r=0;
  linee.forEach(function(L){
    var x=(c.x-c.y)+L;
    if(x>0.001) v+=1/linee.length; else if(Math.abs(x)<=0.001) r+=1/linee.length;
  });
  if(r>=0.999) return;            /* rimborso pieno: non dice niente */
  var esito=v/(1-r);              /* 0, 0.5 o 1 al netto del rimborso */
  righe.push({puro:puro.coperta, anc:anc.coperta, mer:mer.coperta, esito:esito, peso:1-r});
});
console.log('partite con handicap e esito non rimborsato:',righe.length);
function brier(campo){
  var s=0, w=0;
  righe.forEach(function(x){ s+=x.peso*(x[campo]-x.esito)*(x[campo]-x.esito); w+=x.peso; });
  return s/w;
}
console.log('');
console.log('  errore sul "casa copre la linea" (Brier, piu basso e meglio)');
console.log('    modello puro              '+brier('puro').toFixed(5));
console.log('    modello ancorato al 1X2   '+brier('anc').toFixed(5));
console.log('    il mercato dell handicap  '+brier('mer').toFixed(5));
function conf(t,a,b){
  var d=[], w=[];
  righe.forEach(function(x){
    d.push(x.peso*((x[a]-x.esito)*(x[a]-x.esito)-(x[b]-x.esito)*(x[b]-x.esito)));
  });
  var m=d.reduce(function(s,x){return s+x;},0)/d.length;
  var sd=Math.sqrt(d.reduce(function(s,x){return s+(x-m)*(x-m);},0)/(d.length-1));
  console.log('\n  '+t+': '+(100*m/brier(a)).toFixed(2)+'%  z='+(m/(sd/Math.sqrt(d.length))).toFixed(2));
}
conf('il mercato batte il modello ancorato di', 'anc', 'mer');
conf('e batte il modello puro di', 'puro', 'mer');
/* quanto dissentono? se il modello ancorato gia' riproduce l'handicap, la
   correlazione fra i due e' altissima e non c'e' niente da guadagnare */
var mm=righe.reduce(function(s,x){return s+x.anc;},0)/righe.length;
var mq=righe.reduce(function(s,x){return s+x.mer;},0)/righe.length;
var sx=0,sy=0,sxy=0;
righe.forEach(function(x){ var a=x.anc-mm,b=x.mer-mq; sx+=a*a; sy+=b*b; sxy+=a*b; });
var r = sxy / Math.sqrt(sx * sy);
console.log('\n  quanto si somigliano modello ancorato e mercato handicap: r=' + r.toFixed(4));
var scarti=righe.map(function(x){return Math.abs(x.anc-x.mer);});
scarti.sort(function(a,b){return a-b;});
console.log('  scarto tipico fra i due: '+(100*scarti[Math.floor(scarti.length/2)]).toFixed(1)+' punti (mediana)');
console.log('');
console.log(r > 0.85
  ? 'L\'handicap dice quello che il 1X2 dice gia. Non e sorprendente: sono due modi\n' +
    'di scrivere la stessa cosa — quanto una squadra e data favorita — e i bookmaker\n' +
    'li tengono coerenti fra loro, se no ci si guadagnerebbe scommettendo sull\'uno\n' +
    'contro l\'altro. Aggiungerlo all\'ancoraggio non porterebbe informazione, solo\n' +
    'un terzo modo di ripetersi.'
  : 'L\'handicap dice qualcosa che il 1X2 non dice: vale la pena metterlo\nnell\'ancoraggio.');
