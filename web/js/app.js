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
  var family = window.VIDAAFamily ? window.VIDAAFamily.create(window.localStorage) : null;
  var sectionItems = {tv:[],movies:[],series:[]};
  var detailItem = null, playerItem = null, playerKind = 'tv';
  var lastProgressSave = 0;
  var previousScreen = 'catalog';
  var state = {
    section: 'tv', query: '', category: 'all', page: 0, more: false, total: 0,
    busy: false, requestId: 0, searchTimer: null, screen: 'login',
    hls: null, streamTimer: null, currentChannel: null, lastFocus: null,
    view: 'all', lastFailure: '', retryCount: 0, liveSourceIndex: 0, liveSourceCount: 1, liveWatchdog: null, liveLastTime: -1, liveLastProgress: 0, liveStarted: false, diagnosticSeq: 0, playbackSeq: 0
  };
  function show(id, visible) { $(id).hidden = !visible; }
  function text(id, value) { $(id).textContent = value || ''; }
  function error(message) { text('notice', message); }
  function setPasswordVisible(visible) {
    var field = $('password');
    var toggle = $('passwordToggle');
    var label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
    field.type = visible ? 'text' : 'password';
    toggle.className = visible ? 'password-toggle is-visible' : 'password-toggle';
    toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
  function showLogin(message) {
    show('splash', false);
    show('shell', false);
    show('auth', true);
    setPasswordVisible(false);
    state.screen = 'login';
    text('loginError', message || '');
    $('password').focus();
  }
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
      else if (xhr.status === 200) { showLogin(''); }
      else { showLogin('El servidor no pudo comprobar tu sesión (HTTP ' + xhr.status + ').'); }
    };
    xhr.onerror = function () { showLogin('No se pudo conectar con el servidor.'); };
    xhr.ontimeout = function () { showLogin('La conexión tardó demasiado. Intenta ingresar nuevamente.'); };
    try { xhr.send(); }
    catch (_) { showLogin('No se pudo iniciar la conexión.'); }
  }
  function enter() {
    show('splash', false);
    show('auth', false);
    show('shell', true);
    show('detail', false);
    show('player', false);
    state.screen = 'catalog';
    if (family) $('profile').value = family.active();
    changeSection('tv');
  }
  function login(event) {
    if (event && event.preventDefault) event.preventDefault();
    var button = $('loginForm').querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    text('loginError', 'Verificando…');
    api('login', {password: $('password').value}, function (err, payload) {
      button.disabled = false;
      if (err || !payload || !payload.authenticated) {
        text('loginError',err || 'No se pudo iniciar sesión.');
        return;
      }
      $('password').value = '';
      setPasswordVisible(false);
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
      setPasswordVisible(false);
      $('password').focus();
    });
  }
  function changeSection(section) {
    if (!labels[section]) return;
    state.section = section;
    state.query = '';
    state.category = 'all';
    state.view = 'all';
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
    updateQuickActions();
    if (section === 'tv') loadCategories();
    fetchPage(1,false);
  }

  function currentKind() { return state.section; }
  function quickButton(name, current) {
    $(name).className = 'view-button' + (state.view === current ? ' selected' : '');
    $(name).setAttribute('aria-pressed', state.view === current ? 'true' : 'false');
  }
  function updateQuickActions() {
    quickButton('allFilter','all');
    quickButton('favoritesFilter','favorites');
    quickButton('recentFilter','recent');
    quickButton('continueFilter','continue');
    var last = family && family.lastChannel();
    show('lastChannel', state.section === 'tv' && !!last);
    show('continueFilter', state.section !== 'tv' && !!family && family.progress().some(function (p) {
      return p.kind === state.section;
    }));
    $('category').disabled = state.view !== 'all';
    var recent = family && family.progress().filter(function (p) {return p.kind === state.section;});
    if (recent && recent.length && state.section !== 'tv') {
      text('continueHint', 'Continúa donde quedaste: ' + recent[recent.length-1].title);
      show('continueHint',true);
    } else { show('continueHint',false); }
  }
  function setView(view) {
    if (view !== 'all' && view !== 'favorites' && view !== 'recent' && view !== 'continue') return;
    state.view = view;
    state.requestId++;
    updateQuickActions();
    if (view === 'all') fetchPage(1,false);
    else renderPersonalView();
  }
  function renderPersonalView() {
    var section=state.section, items=[];
    state.busy=false;
    show('catalogLoader',false);
    show('more',false);
    $('results').textContent='';
    if (family) {
      if (state.view === 'favorites') items = family.favorites(section);
      if (state.view === 'recent') items = family.recent().filter(function (x) {return x.kind === section;});
      if (state.view === 'continue') items = family.progress().filter(function (x) {return x.kind === section;});
    }
    var q=String(state.query||'').toLowerCase();
    if (q) items = items.filter(function (x) {return String(x.title||'').toLowerCase().indexOf(q) !== -1;});
    text('count',items.length+' resultados');
    error(items.length ? '' : 'Todavía no tienes elementos guardados en esta sección.');
    items.forEach(function (item) {
      addCard({
        id:item.id,channelCode:item.kind==='tv'?item.id:undefined,
        title:item.title,name:item.title,category:item.category,year:item.year
      },section);
    });
  }
  function rememberWatched(kind,item) {
    if (family) { family.watched(kind,item); updateQuickActions(); }
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
    if (state.view !== 'all') return renderPersonalView();
    var id=++state.requestId, section=state.section;
    state.busy=true;
    show('more', false);
    show('catalogLoader', !append);
    if (!append) $('results').textContent='';
    text('catalogLoaderText', 'Cargando ' +
      (section==='tv'?'canales':section==='movies'?'películas':'series') + '…');
    error(append ? 'Cargando más resultados…' : '');
    var input = {pageNum:page,pageSize:24,search:state.query};
    if (section==='tv') { input.columnId=state.category; }
    else { input.category=state.category; }
    api(endpoints[section],input,function(err,result) {
      if (id!==state.requestId || section!==state.section || state.screen!=='catalog') return;
      state.busy=false;
      show('catalogLoader', false);
      if (err) {
        state.lastFailure=err;
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
      if (!append) sectionItems[section]=items.slice();
      else sectionItems[section]=sectionItems[section].concat(items);
      for (var i=0;i<items.length;i++) addCard(items[i],section);
      show('more', state.more);
    });
  }
  function addCard(item,section) {
    var entry=make('div','catalog-item');
    var button=make('button','focus-card'+(section==='tv'?' channel-card':''));
    button.type='button';
    var cover=make('span','cover');
    if (item.logo || item.poster) {
      var image=make('img');
      image.alt='';
      image.loading='lazy';
      image.src=item.logo || item.poster;
      image.onerror=function(){ if(image.parentNode) image.parentNode.removeChild(image); };
      cover.appendChild(image);
    } else { cover.textContent=section==='tv'?'▣':section==='movies'?'▶':'▤'; }
    button.appendChild(cover);
    button.appendChild(make('span','title',item.name||item.title||'Sin título'));
    button.appendChild(make('span','subtitle',section==='tv'?'EN VIVO':
      section==='series'?((item.seasonCount||0)+' temporadas'):item.year||'PELÍCULA'));
    button.onclick=function () {
      state.lastFocus=button;
      if (section==='tv') openLive(item);
      else if (state.view==='continue' || (state.view==='recent' && /^ep-/.test(item.id))) {
        playVod(item,section);
      } else openDetail(item);
    };
    entry.appendChild(button);
    var star=make('button','favorite-button',family && family.isFavorite(section,item.channelCode||item.id)?'★':'☆');
    star.type='button';
    star.setAttribute('aria-label','Cambiar favorito');
    star.setAttribute('aria-pressed',family && family.isFavorite(section,item.channelCode||item.id)?'true':'false');
    star.onclick=function() {
      if(!family) return;
      var now=family.toggleFavorite(section,item);
      star.textContent=now?'★':'☆';
      star.setAttribute('aria-pressed',now?'true':'false');
      if(state.view==='favorites')renderPersonalView();
    };
    entry.appendChild(star);
    $('results').appendChild(entry);
  }

  function changeQuery() {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.query = $('search').value.slice(0,100).trim();
    state.requestId += 1;
    state.searchTimer=setTimeout(function(){
      if (state.view === 'all') fetchPage(1,false);
      else renderPersonalView();
    },350);
  }
  function clearSearch() { $('search').value=''; changeQuery(); $('search').focus(); }
  function openDetail(item) {
    detailItem=item;
    state.screen='detail';
    show('detail',true);
    text('detailTitle',item.title||'Sin título');
    text('detailType',state.section==='series'?'SERIE':'PELÍCULA');
    text('detailCategory',item.category||'');
    text('detailMessage','');
    show('detailPlay',state.section==='movies');
    var starred=!!(family && family.isFavorite(state.section,item.id));
    text('detailFavorite',starred?'★ Quitar de favoritos':'☆ Guardar en favoritos');
    $('detailFavorite').setAttribute('aria-pressed',starred?'true':'false');
    var poster=$('detailPoster');poster.textContent='';
    if (item.poster) {
      var img=make('img');img.alt='';img.src=item.poster;
      poster.appendChild(img);
    }
    $('seasons').textContent='';
    if (state.section==='series') {
      var selectedId=item.id;
      api('m3uDetail',{id:selectedId},function(err,data) {
        if (state.screen!=='detail' || !detailItem || detailItem.id!==selectedId) return;
        if (err) {text('detailMessage',err);return;}
        var seasons=data.seasons||[];
        var host=$('seasons');
        if (!seasons.length) {host.appendChild(make('p',null,'No se encontraron episodios.'));return;}
        for (var i=0;i<seasons.length;i++) {
          var season=seasons[i];
          host.appendChild(make('h3',null,'Temporada '+(season.number||i+1)));
          var eps=season.episodes||[];
          for (var j=0;j<eps.length;j++) {
            (function(ep,number,seriesTitle) {
              var row=make('button','episode-button',
                '▶ Episodio '+(ep.number||number)+' · '+(ep.title||'Sin título'));
              row.type='button';
              row.onclick=function() {
                state.lastFocus=row;
                playVod({id:ep.id,title:seriesTitle+' · '+(ep.title||'Episodio '+number)},'series');
              };
              host.appendChild(row);
            })(eps[j],j+1,item.title||'Serie');
          }
        }
      });
    }
    $('detailBack').focus();
  }
  function playVod(item,kind) {
    if (!item || !/^(mov-|ep-)/.test(String(item.id||''))) {
      text('detailMessage','Este título todavía no tiene una referencia válida.');
      return;
    }
    previousScreen=state.screen==='detail'?'detail':'catalog';
    stopVideo();
    state.screen='player';
    playerKind=kind;
    playerItem={id:item.id,title:item.title||'Video',kind:kind};
    text('playerTitle',playerItem.title);
    text('playerMessage','Preparando video privado…');
    show('player',true);
    show('prevChannel',false);
    show('nextChannel',false);
    show('retryChannel',true);
    resolveVodPlayback();
    $('playerBack').focus();
  }
  function resolveVodPlayback() {
    if (!playerItem || state.screen!=='player') return;
    var target=playerItem.id;
    api('resolve',{contentId:target},function(err,result) {
      if (state.screen!=='player' || !playerItem || playerItem.id!==target) return;
      if (err) {
        state.lastFailure=err;
        text('playerMessage',err);
        return;
      }
      rememberWatched(playerKind,playerItem);
      text('playerMessage','');
      attachMedia(result);
    });
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
    stopLiveWatchdog();
    state.playbackSeq++;
    savePlaybackProgress();
    if (state.streamTimer) { clearTimeout(state.streamTimer); state.streamTimer=null; }
    destroyHls();
    var video=$('video');
    try { video.pause(); } catch (_) {}
    video.removeAttribute('src');
    try { video.load(); } catch (_) {}
    state.currentChannel=null;
  }
  function savePlaybackProgress() {
    if (!family || !playerItem || playerKind==='tv') return;
    var video=$('video');
    family.putProgress(playerKind,playerItem,video.currentTime||0,video.duration||0);
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
    var instance=state.hls;
    state.hls.loadSource(source);
    state.hls.attachMedia($('video'));
    state.hls.on(window.Hls.Events.MANIFEST_PARSED,function(){if(state.hls===instance)playCurrentVideo();});
    state.hls.on(window.Hls.Events.ERROR,function(_event,data){
      if(data && data.fatal && state.screen==='player' && playerKind==='tv' && state.hls===instance) tryNextLiveSource('La señal HLS falló.');
    });
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
        var seq=state.playbackSeq;
        text('playerMessage','Preparando reproductor HTML5…');
        getHlsLibrary(function(ok) {
          if(state.screen!=='player'||state.currentChannel!==current||state.playbackSeq!==seq)return;
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
  function stopLiveWatchdog() {
    if(state.liveWatchdog){clearInterval(state.liveWatchdog);state.liveWatchdog=null;}
    state.liveStarted=false;
    state.liveLastTime=-1;
    state.liveLastProgress=0;
  }
  function startLiveWatchdog() {
    stopLiveWatchdog();
    state.liveLastProgress=Date.now();
    state.liveWatchdog=setInterval(function(){
      if(state.screen!=='player'||playerKind!=='tv'||!state.currentChannel)return;
      var video=$('video');
      if(document.hidden || video.ended)return;
      if(!state.liveStarted){
        if(Date.now()-state.liveLastProgress>35000){
          stopLiveWatchdog();
          tryNextLiveSource('La señal no inició.');
        }
        return;
      }
      if(video.paused)return;
      if(video.currentTime>state.liveLastTime+0.15){
        state.liveLastTime=video.currentTime;
        state.liveLastProgress=Date.now();
      } else if(Date.now()-state.liveLastProgress>25000){
        stopLiveWatchdog();
        tryNextLiveSource('La transmisión no avanza.');
      }
    },5000);
  }
  function tryNextLiveSource(reason) {
    if(state.screen!=='player' || playerKind!=='tv' || !state.currentChannel)return;
    if(state.liveSourceIndex+1 < state.liveSourceCount) {
      stopLiveWatchdog();
      state.liveSourceIndex++;
      state.retryCount=0;
      if(state.streamTimer) { clearTimeout(state.streamTimer); state.streamTimer=null; }
      destroyHls();
      try { $('video').pause(); $('video').removeAttribute('src'); $('video').load(); } catch(_) {}
      text('playerMessage',reason+' Probando señal alternativa '+(state.liveSourceIndex+1)+'/'+state.liveSourceCount+'…');
      playResolved(state.currentChannel);
    } else {
      stopLiveWatchdog();
      state.lastFailure=reason+' No hay más señales compatibles disponibles.';
      text('playerMessage',state.lastFailure+' Pulsa Reintentar o Volver.');
    }
  }
  function playResolved(ch) {
    api('resolveLive',{channelCode:ch.channelCode || ch.id,sourceIndex:state.liveSourceIndex},function(err,stream) {
      if (state.screen!=='player' || state.currentChannel!==ch || Number(stream && stream.sourceIndex)!==state.liveSourceIndex && !err) return;
      if (err) {
        state.lastFailure=err;
        if (state.retryCount < 2) {
          state.retryCount++;
          text('playerMessage','Reconectando señal (intento '+state.retryCount+'/2)…');
          if (state.streamTimer) clearTimeout(state.streamTimer);
          state.streamTimer=setTimeout(function(){
            if(state.screen==='player' && state.currentChannel===ch)playResolved(ch);
          },3000*state.retryCount);
        } else text('playerMessage',err+' · Pulsa Reintentar.');
        return;
      }
      state.retryCount=0;
      state.liveSourceCount=Number(stream.sourceCount)||1;
      startLiveWatchdog();
      text('playerMessage','');
      attachMedia(stream);
      // Do not reconnect an active HLS player on a timer: it disrupts playback.
      // Re-resolve only after a real media error, stall or explicit retry.
    });
  }
  function openLive(ch) {
    stopVideo();
    playerItem=null;
    playerKind='tv';
    previousScreen='catalog';
    state.retryCount=0;
    state.liveSourceIndex=0;
    state.liveSourceCount=1;
    state.screen='player';
    state.currentChannel=ch;
    rememberWatched('tv',ch);
    text('playerTitle',ch.name||'TV en vivo');
    text('playerMessage','Conectando con la señal…');
    show('prevChannel',true);
    show('nextChannel',true);
    show('retryChannel',true);
    show('player',true);
    playResolved(ch);
    $('playerBack').focus();
  }
  function nextLive(direction) {
    if (state.screen!=='player' || !state.currentChannel) return;
    var list=sectionItems.tv || [];
    if (family && state.view==='favorites') list=family.favorites('tv').map(function (x) {
      return {id:x.id,channelCode:x.id,name:x.title};
    });
    if (!list.length) {text('playerMessage','No hay canales para cambiar.');return;}
    var index=-1,current=state.currentChannel.channelCode||state.currentChannel.id;
    for(var i=0;i<list.length;i++) if((list[i].channelCode||list[i].id)===current){index=i;break;}
    var next=list[(index+(direction>0?1:list.length-1)+list.length)%list.length];
    if (next) openLive(next);
  }
  function retryPlayback() {
    if (state.screen!=='player') return;
    state.retryCount=0;
    state.liveSourceIndex=0;
    state.liveSourceCount=1;
    if (playerItem) {
      stopVideo();
      resolveVodPlayback();
    } else if (state.currentChannel) {
      var ch=state.currentChannel;
      stopVideo();
      state.currentChannel=ch;
      playResolved(ch);
    }
  }
  function closePlayer() {
    stopVideo();
    playerItem=null;
    show('player',false);
    if (previousScreen==='detail' && !$('detail').hidden) {
      state.screen='detail';
      if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
      else $('detailBack').focus();
    } else {
      state.screen='catalog';
      if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
      else $('search').focus();
    }
  }
  function diagnosticRow(label,value) {
    var row=make('div','diagnostic-row');
    row.appendChild(make('strong',null,label));
    row.appendChild(make('span',null,value));
    $('diagnosticsList').appendChild(row);
  }
  function refreshDiagnostics() {
    var serial=++state.diagnosticSeq;
    $('diagnosticsList').textContent='';
    diagnosticRow('Conexión','Comprobando…');
    api('ping',{},function(err,body) {
      if(state.screen!=='diagnostics' || state.diagnosticSeq!==serial)return;
      diagnosticRow('Servidor',err?'Sin respuesta':body.service||'Disponible');
    });
    api('m3uStatus',{},function(err,body){
      if(state.screen!=='diagnostics' || state.diagnosticSeq!==serial)return;
      diagnosticRow('Biblioteca privada',err?'No se pudo comprobar':body.configured?'Configurada':'Sin configurar');
      if (!err && body.cacheReady) {
        diagnosticRow('Películas',String(body.moviesCount||0));
        diagnosticRow('Series',String(body.seriesCount||0));
        diagnosticRow('Episodios',String(body.episodesCount||0));
        diagnosticRow('Catálogo actualizado',body.updatedAt?new Date(body.updatedAt).toLocaleDateString():'Sin fecha');
      }
    });
    api('liveChannels',{pageNum:1,pageSize:1},function(err,body){
      if(state.screen!=='diagnostics' || state.diagnosticSeq!==serial)return;
      diagnosticRow('Canales IPTV',err?'Servicio no disponible':(body.total||0)+' con señal registrada');
    });
    diagnosticRow('Reproducción HLS', $('video').canPlayType('application/vnd.apple.mpegurl')?
      'HLS nativo disponible':'Puede requerir HLS.js');
    diagnosticRow('Almacenamiento local',family?'Perfiles y favoritos activos':'No disponible');
    diagnosticRow('Último error',state.lastFailure||'Ninguno registrado');
  }
  function openDiagnostics() {
    if(state.screen==='player')closePlayer();
    previousScreen=state.screen;
    state.screen='diagnostics';
    show('diagnostics',true);
    refreshDiagnostics();
    $('diagnosticsBack').focus();
  }
  function closeDiagnostics() {
    ++state.diagnosticSeq;
    show('diagnostics',false);
    state.screen=previousScreen==='detail'?'detail':'catalog';
    $(state.screen==='detail'?'detailBack':'diagnosticsButton').focus();
  }
  function focusScopeControls() {
    var root=$({login:'auth',catalog:'shell',detail:'detail',player:'player',diagnostics:'diagnostics'}[state.screen]);
    var list=root ? root.querySelectorAll('button:not([disabled]), input:not([disabled]),select:not([disabled])') : [];
    var items=[];
    for(var i=0;i<list.length;i++) {
      if(list[i].offsetWidth && list[i].offsetHeight)items.push(list[i]);
    }
    return items;
  }
  function navigate(dir) {
    var current=document.activeElement;
    var items=focusScopeControls();
    if (!items.length) return false;
    if (!current || items.indexOf(current)<0) { items[0].focus();return true; }
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
    if(best){best.focus();if(best.scrollIntoView)best.scrollIntoView({block:'nearest',inline:'nearest'});return true;}
    return false;
  }
  function handleRemote(e) {
    var key=e.keyCode||e.which;
    var active=document.activeElement;
    var editing=active && (active.tagName==='INPUT' || active.tagName==='SELECT');
    var back=key===461||key===27||(key===8&&!editing)||
      e.key==='GoBack'||e.key==='BrowserBack'||e.key==='Escape';
    if(back) {
      if(state.screen==='player') closePlayer();
      else if(state.screen==='diagnostics')closeDiagnostics();
      else if(state.screen==='detail')closeDetail();
      else if(editing) {
        var exitDirection=active.tagName==='SELECT'?'right':'down';
        if(!navigate(exitDirection) && !navigate(exitDirection==='right'?'left':'up') && active.blur)active.blur();
      }
      else if(state.screen==='catalog') {
        // When running as a hosted VIDAA app, Back from home exits.
        if(window.history && window.history.length>1)window.history.back();
        else if(window.close)window.close();
      }
      e.preventDefault();return;
    }
    if(key===9) {
      var controls=focusScopeControls();
      if(controls.length) {
        var position=controls.indexOf(active);
        var next=position<0?(e.shiftKey?controls.length-1:0):
          (position+(e.shiftKey?-1:1)+controls.length)%controls.length;
        controls[next].focus();e.preventDefault();
      }
      return;
    }
    if(editing) {
      // Inputs keep text/caret keys; vertical arrows leave the field. Selects
      // keep native option arrows and use horizontal arrows to leave.
      var leaveInput=active.tagName==='INPUT' && (key===38||key===40);
      var leaveSelect=active.tagName==='SELECT' && (key===37||key===39);
      var caretEdge=false;
      if(active.tagName==='INPUT' && (key===37||key===39)) {
        try {
          caretEdge=active.selectionStart===active.selectionEnd &&
            (key===37?active.selectionStart===0:active.selectionEnd===String(active.value||'').length);
        }catch(_){}
      }
      if(leaveInput||leaveSelect||caretEdge) {
        if(navigate(key===37?'left':key===38?'up':key===39?'right':'down'))e.preventDefault();
      }
      return;
    }
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
  $('passwordToggle').addEventListener('click',function(){
    setPasswordVisible($('password').type === 'password');
  });
  $('profile').addEventListener('change',function(){
    if(!family || !family.pickProfile(this.value))return;
    if(state.screen==='player')closePlayer();
    if(state.screen==='detail')closeDetail();
    changeSection(state.section);
  });
  $('allFilter').addEventListener('click',function(){setView('all');});
  $('favoritesFilter').addEventListener('click',function(){setView('favorites');});
  $('recentFilter').addEventListener('click',function(){setView('recent');});
  $('continueFilter').addEventListener('click',function(){setView('continue');});
  $('lastChannel').addEventListener('click',function(){
    var last=family&&family.lastChannel();
    if(last)openLive({id:last.id,channelCode:last.id,name:last.title});
  });
  $('detailFavorite').addEventListener('click',function(){
    if(!family || !detailItem)return;
    var on=family.toggleFavorite(state.section,detailItem);
    text('detailFavorite',on?'★ Quitar de favoritos':'☆ Guardar en favoritos');
    $('detailFavorite').setAttribute('aria-pressed',on?'true':'false');
  });
  $('detailPlay').addEventListener('click',function(){
    if(detailItem)playVod(detailItem,'movies');
  });
  $('prevChannel').addEventListener('click',function(){nextLive(-1);});
  $('nextChannel').addEventListener('click',function(){nextLive(1);});
  $('retryChannel').addEventListener('click',retryPlayback);
  $('diagnosticsButton').addEventListener('click',openDiagnostics);
  $('diagnosticsBack').addEventListener('click',closeDiagnostics);
  $('diagnosticsRefresh').addEventListener('click',refreshDiagnostics);
  $('video').addEventListener('playing',function(){
    if(state.screen==='player' && playerKind==='tv'){
      state.liveStarted=true;
      state.liveLastProgress=Date.now();
      state.liveLastTime=$('video').currentTime;
    }
  });
  $('video').addEventListener('timeupdate',function(){
    if(state.screen==='player' && playerKind==='tv' && state.liveStarted && $('video').currentTime>state.liveLastTime+0.15){
      state.liveLastTime=$('video').currentTime;
      state.liveLastProgress=Date.now();
    }
    if(state.screen==='player' && playerItem && Date.now()-lastProgressSave>10000) {
      lastProgressSave=Date.now();savePlaybackProgress();
    }
  });
  $('video').addEventListener('loadedmetadata',function(){
    if(!playerItem||!family)return;
    var previous=family.progress().filter(function(p){return p.id===playerItem.id;})[0];
    if(previous && previous.position>10 && previous.position<$('video').duration-30){
      try{$('video').currentTime=previous.position;}catch(_){}
    }
  });
  $('video').addEventListener('ended',function(){
    if(family && playerItem)family.putProgress(playerKind,playerItem,0,100);
  });
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
    if(state.screen==='player') {
      state.lastFailure='El video no pudo reproducirse en este dispositivo.';
      if(playerKind==='tv')tryNextLiveSource(state.lastFailure);
      else text('playerMessage',state.lastFailure+' Pulsa Reintentar o Volver.');
    }
  });
  document.addEventListener('visibilitychange',function(){
    if(document.hidden) {
      setPasswordVisible(false);
      if(state.screen==='player')$('video').pause();
    }
  });
  window.addEventListener('pagehide',stopVideo);
  sessionCheck();
})();
