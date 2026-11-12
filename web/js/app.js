/* TVVIDAA: standalone web/VIDAA client. No Luna, webOS or third-party portal. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function make(tag, className, value) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (value !== undefined && value !== null) { node.textContent = String(value); }
    return node;
  }
  var labels = {
    tv: ['TELEVISIÓN', 'TV en vivo', 'Selecciona un canal para comenzar.', 'Buscar canales...'],
    movies: ['CINE', 'Películas', 'Encuentra una película en tu biblioteca.', 'Buscar películas...'],
    series: ['SERIES', 'Series', 'Explora temporadas y episodios.', 'Buscar series...']
  };
  var endpoints = { tv: 'liveChannels', movies: 'm3uMovies', series: 'm3uSeries' };
  var state = {
    section: 'tv', query: '', category: 'all', page: 0, more: false, total: 0,
    busy: false, requestId: 0, searchTimer: null, screen: 'login',
    hls: null, streamTimer: null, currentChannel: null, lastFocus: null
  };
  function show(id, visible) { $(id).hidden = !visible; }
  function text(id, value) { $(id).textContent = value || ''; }
  function error(message) { text('notice', message); }
  function api(method, params, done) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/' + method, true);
    xhr.timeout = 30000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var result;
      try { result = JSON.parse(xhr.responseText || '{}'); }
      catch (_) { return done('El servidor devolvió una respuesta inválida.'); }
      if (xhr.status < 200 || xhr.status > 299 || result.returnValue === false) {
        return done(result.errorText || result.error || 'No se pudo consultar el servicio.');
      }
      done(null, result);
    };
    xhr.onerror = function () { done('No hay conexión con el servidor.'); };
    xhr.ontimeout = function () { done('El servidor tardó demasiado.'); };
    try { xhr.send(JSON.stringify(params || {})); }
    catch (_) { done('No se pudo iniciar la consulta.'); }
  }
  function sessionCheck() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/session', true);
    xhr.timeout = 10000;
    xhr.onload = function () {
      var result = {};
      try { result = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status === 200 && result.authenticated) { enter(); }
      else { show('auth', true); show('shell', false); $('password').focus(); }
    };
    xhr.onerror = function () {
      show('auth', true);
      text('loginError','No se pudo conectar con el servidor.');
    };
    xhr.send();
  }
  function enter() {
    show('auth', false);
    show('shell', true);
    show('detail', false);
    show('player', false);
    state.screen = 'catalog';
    changeSection('tv');
  }
  function login(event) {
    if (event && event.preventDefault) event.preventDefault();
    var button = $('loginForm').querySelector('button');
    button.disabled = true;
    text('loginError', 'Verificando…');
    api('login', {password: $('password').value}, function (err, payload) {
      button.disabled = false;
      if (err || !payload || !payload.authenticated) {
        text('loginError',err || 'No se pudo iniciar sesión.');
        return;
      }
      $('password').value = '';
      enter();
    });
  }
  function logout() {
    api('logout', {}, function () {
      state.requestId += 1;
      stopVideo();
      state.screen = 'login';
      show('shell', false);
      show('player', false);
      show('detail', false);
      show('auth', true);
      $('password').focus();
    });
  }
  function changeSection(section) {
    if (!labels[section]) return;
    state.section = section;
    state.query = '';
    state.category = 'all';
    state.requestId += 1;
    if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
    $('search').value = '';
    $('search').placeholder = labels[section][3];
    text('eyebrow',labels[section][0]);
    text('heading',labels[section][1]);
    text('description',labels[section][2]);
    text('count','');
    text('notice','');
    var nav = document.querySelectorAll('[data-section]');
    for (var i=0; i<nav.length; i++) {
      var active = nav[i].getAttribute('data-section') === section;
      nav[i].className = 'nav-button' + (active ? ' selected' : '');
      nav[i].setAttribute('aria-current',active ? 'page' : 'false');
    }
    var category=$('category');
    category.hidden = section !== 'tv';
    category.value = 'all';
    $('results').textContent = '';
    show('more', false);
    if (section === 'tv') loadCategories();
    fetchPage(1,false);
  }
  function loadCategories() {
    api('liveCategories',{},function(err,body) {
      if (err || state.section !== 'tv') return;
      var select=$('category'), previous=select.value;
      select.textContent='';
      var all=make('option',null,'Todos los canales'); all.value='all'; select.appendChild(all);
      var cats=(body.categories||[]).slice(0,60);
      for (var i=0;i<cats.length;i++) {
        if (!cats[i].id || cats[i].id==='all') continue;
        var option=make('option',null,cats[i].name||cats[i].id);
        option.value=cats[i].id;
        select.appendChild(option);
      }
      select.value=previous || 'all';
    });
  }
  function fetchPage(page,append) {
    var id=++state.requestId, section=state.section;
    state.busy=true;
    show('more', false);
    if (!append) $('results').textContent='';
    error('Cargando '+(section==='tv'?'canales':section==='movies'?'películas':'series')+'…');
    var input = {pageNum:page,pageSize:24,search:state.query};
    if (section==='tv') { input.columnId=state.category; }
    else { input.category=state.category; }
    api(endpoints[section],input,function(err,result) {
      if (id!==state.requestId || section!==state.section || state.screen!=='catalog') return;
      state.busy=false;
      if (err) {
        error(err);
        text('connection','Servicio no disponible');
        return;
      }
      text('connection','Conectado');
      state.page=page;
      state.more=!!result.hasMore;
      state.total=result.total||0;
      text('count',state.total+' resultados');
      var items=section==='tv' ? (result.channels||[]) : (result.items||[]);
      if (!items.length && page===1) {
        error(section!=='tv' && result.configured===false
          ? 'La biblioteca privada aún no está configurada en el servidor.'
          : state.query ? 'No encontramos coincidencias. Prueba otro nombre.' :
            'No hay contenido disponible en esta categoría.');
      } else {
        error('');
      }
      for (var i=0;i<items.length;i++) addCard(items[i],section);
      show('more', state.more);
    });
  }
  function addCard(item,section) {
    var button=make('button','focus-card'+(section==='tv'?' channel-card':''));
    button.type='button';
    var cover=make('span','cover');
    if (item.logo || item.poster) {
      var image=make('img');
      image.alt='';
      image.loading='lazy';
      image.src=item.logo || item.poster;
      image.onerror=function(){ image.parentNode.removeChild(image); };
      cover.appendChild(image);
    } else { cover.textContent=section==='tv'?'▣':section==='movies'?'▶':'▤'; }
    button.appendChild(cover);
    button.appendChild(make('span','title',item.name||item.title||'Sin título'));
    button.appendChild(make('span','subtitle',section==='tv'?'EN VIVO':
      section==='series'?((item.seasonCount||0)+' temporadas'):item.year||'PELÍCULA'));
    button.onclick=function () {
      state.lastFocus=button;
      if (section==='tv') openLive(item);
      else openDetail(item);
    };
    $('results').appendChild(button);
  }
  function changeQuery() {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.query = $('search').value.slice(0,100).trim();
    state.requestId += 1;
    state.searchTimer=setTimeout(function(){fetchPage(1,false);},350);
  }
  function clearSearch() { $('search').value=''; changeQuery(); $('search').focus(); }
  function openDetail(item) {
    state.screen='detail';
    show('detail',true);
    text('detailTitle',item.title||'Sin título');
    text('detailType',state.section==='series'?'SERIE':'PELÍCULA');
    text('detailCategory',item.category||'');
    text('detailMessage','La biblioteca está disponible; la reproducción privada se habilitará cuando pase las pruebas de seguridad.');
    var poster=$('detailPoster'); poster.textContent='';
    if (item.poster) {
      var img=make('img'); img.alt='';img.src=item.poster;
      poster.appendChild(img);
    }
    $('seasons').textContent='';
    if (state.section==='series') {
      api('m3uDetail',{id:item.id},function(err,data) {
        if (state.screen!=='detail') return;
        if (err) { text('detailMessage',err); return; }
        var seasons=data.seasons||[];
        var host=$('seasons');
        if (!seasons.length) { host.appendChild(make('p',null,'No se encontraron episodios.'));return; }
        for (var i=0;i<seasons.length;i++) {
          var season=seasons[i];
          host.appendChild(make('h3',null,'Temporada '+(season.number||i+1)));
          var eps=season.episodes||[];
          for (var j=0;j<eps.length;j++) {
            var ep=eps[j], row=make('div','episode-button',
              'Episodio '+(ep.number||j+1)+' · '+(ep.title||'Sin título'));
            host.appendChild(row);
          }
        }
      });
    }
    $('detailBack').focus();
  }
  function closeDetail() {
    show('detail',false);
    state.screen='catalog';
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
    else $('search').focus();
  }
  function destroyHls() {
    if (state.hls) {
      try { state.hls.destroy(); } catch (_) {}
      state.hls=null;
    }
  }
  function stopVideo() {
    if (state.streamTimer) { clearTimeout(state.streamTimer); state.streamTimer=null; }
    destroyHls();
    var video=$('video');
    try { video.pause(); } catch (_) {}
    video.removeAttribute('src');
    try { video.load(); } catch (_) {}
    state.currentChannel=null;
  }
  function playCurrentVideo() {
    var play=$('video').play();
    if (play && play.catch) play.catch(function () {
      text('playerMessage','Pulsa Play para iniciar la reproducción.');
    });
  }
  function useHlsLibrary(source) {
    if (!window.Hls || !window.Hls.isSupported || !window.Hls.isSupported()) {
      text('playerMessage','Este dispositivo no admite el formato HLS de este canal.');
      return;
    }
    state.hls=new window.Hls({enableWorker:false});
    state.hls.loadSource(source);
    state.hls.attachMedia($('video'));
    playCurrentVideo();
  }
  var hlsScriptLoading=false, hlsScriptCallbacks=[];
  function getHlsLibrary(done) {
    if (window.Hls) return done(true);
    hlsScriptCallbacks.push(done);
    if (hlsScriptLoading) return;
    hlsScriptLoading=true;
    var script=document.createElement('script'), finished=false;
    function complete(ok) {
      if (finished) return;
      finished=true;
      hlsScriptLoading=false;
      var callbacks=hlsScriptCallbacks.slice();hlsScriptCallbacks=[];
      for(var i=0;i<callbacks.length;i++)callbacks[i](ok);
    }
    script.src='https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    script.async=true;
    script.onload=function(){complete(!!window.Hls);};
    script.onerror=function(){complete(false);};
    document.head.appendChild(script);
    setTimeout(function(){complete(!!window.Hls);},10000);
  }
  function attachMedia(data) {
    var video=$('video'), source=data.mediaUrl;
    if (!source || source.indexOf('/api/media?token=')!==0) {
      text('playerMessage','No se recibió una referencia válida de reproducción.');
      return;
    }
    destroyHls();
    video.removeAttribute('src');
    if (data.isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src=source;
      playCurrentVideo();
    } else if (data.isHls) {
      if (window.Hls) {
        useHlsLibrary(source);
      } else {
        var current=state.currentChannel;
        text('playerMessage','Preparando reproductor HTML5…');
        getHlsLibrary(function(ok) {
          if(state.screen!=='player'||state.currentChannel!==current)return;
          if(!ok){text('playerMessage','El reproductor HLS no está disponible.');return;}
          text('playerMessage','');
          useHlsLibrary(source);
        });
      }
    } else {
      video.src=source;
      playCurrentVideo();
    }
  }
  function playResolved(ch) {
    api('resolveLive',{channelCode:ch.channelCode || ch.id},function(err,stream) {
      if (state.screen!=='player' || state.currentChannel!==ch) return;
      if (err) { text('playerMessage',err);return; }
      text('playerMessage','');
      attachMedia(stream);
      // A TV channel is live and tokens expire; obtain a fresh reference periodically.
      if (state.streamTimer) clearTimeout(state.streamTimer);
      state.streamTimer=setTimeout(function(){
        if (state.screen==='player' && state.currentChannel===ch) playResolved(ch);
      },12*60*1000);
    });
  }
  function openLive(ch) {
    state.screen='player';
    state.currentChannel=ch;
    text('playerTitle',ch.name||'TV en vivo');
    text('playerMessage','Conectando con la señal…');
    show('player',true);
    playResolved(ch);
    $('playerBack').focus();
  }
  function closePlayer() {
    stopVideo();
    show('player',false);
    state.screen='catalog';
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
    else $('search').focus();
  }
  function navigate(dir) {
    var current=document.activeElement;
    var list=document.querySelectorAll('button:not([disabled]), input:not([disabled]),select:not([disabled])');
    var items=[];
    for (var i=0;i<list.length;i++) {
      if (list[i].offsetWidth && list[i].offsetHeight) items.push(list[i]);
    }
    if (!items.length) return;
    if (!current || items.indexOf(current)<0) { items[0].focus();return; }
    var rect=current.getBoundingClientRect(), best=null, score=Infinity;
    var cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
    for (var j=0;j<items.length;j++) {
      var node=items[j];if(node===current)continue;
      var r=node.getBoundingClientRect();
      var dx=r.left+r.width/2-cx,dy=r.top+r.height/2-cy;
      if (dir==='left' && dx>=-5 || dir==='right' && dx<=5 ||
          dir==='up' && dy>=-5 || dir==='down' && dy<=5) continue;
      var primary=dir==='left'||dir==='right'?Math.abs(dx):Math.abs(dy);
      var secondary=dir==='left'||dir==='right'?Math.abs(dy):Math.abs(dx);
      var measure=primary+secondary*2.1;
      if(measure<score){score=measure;best=node;}
    }
    if(best){best.focus();if(best.scrollIntoView)best.scrollIntoView({block:'nearest',inline:'nearest'});}
  }
  function handleRemote(e) {
    var key=e.keyCode||e.which;
    var active=document.activeElement;
    var editing=active && (active.tagName==='INPUT' || active.tagName==='SELECT');
    var back=key===461||key===27||(key===8&&!editing)||
      e.key==='GoBack'||e.key==='BrowserBack'||e.key==='Escape';
    if(back) {
      if(state.screen==='player') closePlayer();
      else if(state.screen==='detail')closeDetail();
      else if(editing && active.blur)active.blur();
      else if(state.screen==='catalog') {
        // When running as a hosted VIDAA app, Back from home exits.
        if(window.history && window.history.length>1)window.history.back();
        else if(window.close)window.close();
      }
      e.preventDefault();return;
    }
    if(editing)return; // Native keyboard/select handles typing and cursor movement.
    if(key===37||key===38||key===39||key===40) {
      navigate(key===37?'left':key===38?'up':key===39?'right':'down');
      e.preventDefault();
    }
    if(key===13||key===32) {
      if(active && active.click){active.click();e.preventDefault();}
    }
    if(state.screen==='player') {
      var video=$('video');
      if(key===415){video.play();e.preventDefault();}
      if(key===19){video.pause();e.preventDefault();}
      if(key===10252){if(video.paused)video.play();else video.pause();e.preventDefault();}
      if(key===413){closePlayer();e.preventDefault();}
    }
  }
  $('loginForm').addEventListener('submit',login);
  $('logout').addEventListener('click',logout);
  $('clearSearch').addEventListener('click',clearSearch);
  $('search').addEventListener('input',changeQuery);
  $('searchShortcut').addEventListener('click',function(){$('search').focus();});
  $('category').addEventListener('change',function(){
    state.category=this.value||'all';fetchPage(1,false);
  });
  $('more').addEventListener('click',function(){
    if(!state.busy && state.more)fetchPage(state.page+1,true);
  });
  $('detailBack').addEventListener('click',closeDetail);
  $('playerBack').addEventListener('click',closePlayer);
  var tabs=document.querySelectorAll('[data-section]');
  for(var k=0;k<tabs.length;k++){
    tabs[k].addEventListener('click',function(){changeSection(this.getAttribute('data-section'));});
  }
  document.addEventListener('keydown',handleRemote,false);
  $('video').addEventListener('error',function(){
    if(state.screen==='player')text('playerMessage','La señal no pudo reproducirse en este dispositivo.');
  });
  document.addEventListener('visibilitychange',function(){
    if(document.hidden && state.screen==='player')$('video').pause();
  });
  window.addEventListener('pagehide',stopVideo);
  sessionCheck();
})();
