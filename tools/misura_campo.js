/* Il vantaggio del campo vale uguale per tutti?

   Il modello ne ha uno solo, valido per tutte e venti le squadre. Ma San Siro
   pieno e uno stadio da diecimila non sembrano la stessa cosa, e nemmeno un
   viaggio a Milano e uno in Sardegna.

   Guardando i residui l'ipotesi sembra reggere: la dispersione dei punteggi z
   e' 1.26 invece di 1.00, la Roma vince in casa mezzo gol piu' del previsto e
   il Monza mezzo gol meno. Ed e' esattamente il punto in cui bisogna fermarsi
   e fare la prova vera, perche' un effetto che si vede nei residui e' un
   effetto misurato SUL PASSATO: la domanda e' se aiuta a prevedere il futuro.

   Qui si da' a ogni squadra il suo vantaggio, stimato solo sul passato e
   tirato verso zero di k partite, e si guarda l'errore fuori campione al
   variare di k. Se l'effetto fosse reale, ci sarebbe un k migliore in mezzo.

   uso: node tools/misura_campo.js
*/
var fs=require('fs'), path=require('path');
var R='/home/user/Prediction_SerieA';
var M=require(path.join(R,'modello.js'));
var doc=JSON.parse(fs.readFileSync(path.join(R,'data','serie-a.json'),'utf8'));
var tutte=doc.partite.filter(function(p){return p.gc!=null;}).sort(function(a,b){return a.d<b.d?-1:1;});
var idx={};
doc.partite.forEach(function(p){ idx[p.d+'|'+p.c+'|'+p.v]=p; });

function rpsTre(pr,e){var c=0,s=0;for(var i=0;i<2;i++){c+=pr[i];var x=(e<=i)?1:0;s+=(c-x)*(c-x);}return s/2;}
function media(l){return l.reduce(function(a,b){return a+b;},0)/l.length;}

var st=(doc.stagioni||[]).slice().sort();
var da=(parseInt(st[Math.max(0,st.length-3)].slice(0,4),10))+'-08-01';
var K=[0,20,40,80,160];            /* 0 = niente ritiro = tutto lo scarto */
var res={}; K.forEach(function(k){ res[k]=[]; });

var mod=null, ultimo=null, eff=null;
tutte.forEach(function(p){
  if(p.d<da) return;
  if(!ultimo || M.giorni(ultimo,p.d)>10){
    var prima=tutte.filter(function(x){return x.d<p.d;});
    if(prima.length<600) return;
    mod=M.costruisci(prima,{fino:p.d, primoTempo:false, iterazioni:120});
    /* effetto campo per squadra, stimato SOLO sul passato */
    var somma={}, quante={};
    prima.forEach(function(x){
      var i=mod.indice[x.c], j=mod.indice[x.v];
      if(i==null||j==null) return;
      var a=M.attesi(mod.gol,i,j);
      if(!a) return;
      somma[x.c]=(somma[x.c]||0)+((x.gc-x.gv)-(a[0]-a[1]));
      quante[x.c]=(quante[x.c]||0)+1;
    });
    eff={};
    Object.keys(somma).forEach(function(sq){ eff[sq]=[somma[sq], quante[sq]]; });
    ultimo=p.d;
  }
  if(!mod) return;
  var i=mod.indice[p.c], j=mod.indice[p.v];
  if(i==null||j==null) return;
  var q=idx[p.d+'|'+p.c+'|'+p.v];
  var e = p.gc>p.gv?0:(p.gc===p.gv?1:2);
  K.forEach(function(k){
    var g=0;
    if(eff[p.c]){
      var s=eff[p.c][0], n=eff[p.c][1];
      g = k===0 ? s/Math.max(1,n) : s/(n+k);
    }
    /* meta' dello scarto all'attacco di casa, meta' tolta a quello ospite */
    var sim=M.simula(mod,p.c,p.v,{N:900, q:(q&&(q.qex||q.q))||null, qou:(q&&q.qou)||null,
                                  agg:{attC:g/2, attV:-g/2}});
    if(sim) res[k].push(rpsTre([sim.fasce.casa.p,sim.fasce.pari.p,sim.fasce.via.p], e));
  });
});
console.log('partite valutate:',res[K[0]].length,'\n');
console.log('  ritiro   errore     contro "campo uguale per tutti"');
var base=media(res[160]);
K.forEach(function(k){
  var m=media(res[k]);
  var etichetta = k===0 ? 'nessuno' : 'k='+k;
  console.log('  '+etichetta.padEnd(9)+m.toFixed(5));
});
/* il confronto vero: campo per squadra (il k migliore) contro campo unico */
var senza=[];
mod=null; ultimo=null;
tutte.forEach(function(p){
  if(p.d<da) return;
  if(!ultimo || M.giorni(ultimo,p.d)>10){
    var prima=tutte.filter(function(x){return x.d<p.d;});
    if(prima.length<600) return;
    mod=M.costruisci(prima,{fino:p.d, primoTempo:false, iterazioni:120});
    ultimo=p.d;
  }
  if(!mod) return;
  var i=mod.indice[p.c], j=mod.indice[p.v];
  if(i==null||j==null) return;
  var q=idx[p.d+'|'+p.c+'|'+p.v];
  var e = p.gc>p.gv?0:(p.gc===p.gv?1:2);
  var sim=M.simula(mod,p.c,p.v,{N:900, q:(q&&(q.qex||q.q))||null, qou:(q&&q.qou)||null});
  if(sim) senza.push(rpsTre([sim.fasce.casa.p,sim.fasce.pari.p,sim.fasce.via.p], e));
});
console.log('  campo unico (come adesso)  '+media(senza).toFixed(5));
var best=K.reduce(function(a,b){ return media(res[b])<media(res[a])?b:a; });
console.log('\n  il migliore per squadra e k='+best+': '+media(res[best]).toFixed(5));
var d=senza.map(function(x,i){return x-res[best][i];});
var m=media(d);
var sd=Math.sqrt(d.reduce(function(s,x){return s+(x-m)*(x-m);},0)/(d.length-1));
var z = m / (sd / Math.sqrt(d.length));
console.log('  guadagno: ' + (100 * m / media(senza)).toFixed(2) + '%  z=' + z.toFixed(2));

console.log('');
var monotono = K.every(function (k, i) {
  return i === 0 || media(res[k]) <= media(res[K[i - 1]]);
});
if (z > 1.9) {
  console.log('Il campo NON vale uguale per tutti: dare a ogni squadra il suo migliora');
  console.log('la previsione, e il k migliore dice quanto fidarsi dei pochi dati che ci sono.');
} else if (monotono) {
  console.log('Il campo vale uguale per tutti. E il modo in cui lo si vede e la parte');
  console.log('interessante: piu si tira l\'effetto verso zero, meglio si prevede — fino al');
  console.log('caso limite, che e non avere nessun effetto per squadra. Quando la risposta');
  console.log('migliore sta sul bordo, l\'effetto che si stava misurando non c\'era.');
  console.log('');
  console.log('Nei residui si vedeva: dispersione 1.26 invece di 1.00, la Roma mezzo gol');
  console.log('sopra e il Monza mezzo gol sotto. Ma quello e un effetto misurato SUL');
  console.log('passato, e con venti squadre il massimo di venti numeri casuali e sempre');
  console.log('notevole. Fuori campione non regge.');
} else {
  console.log('Nessun k migliora in modo distinguibile dal caso.');
}
