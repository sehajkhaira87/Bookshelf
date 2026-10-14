// The approved page-turn and profile animation, independent of the home runtime.
export function createCreatorsBook(root, assets) {
  const screen=root.querySelector('.authors-screen');
  const world=root.querySelector('.authors-world');
  const camera=root.querySelector('.authors-camera');
  const book=root.querySelector('.authors-book');
  const coverLeaf=root.querySelector('.authors-cover-leaf');
  const cover=root.querySelector('.authors-cover-front');
  const gutter=root.querySelector('.authors-gutter');
  const hingePaper=root.querySelector('.authors-hinge-paper');
  const back=root.querySelector('.authors-back');
  const status=root.querySelector('.authors-status');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const workPage=root.querySelector('.authors-work-page');
  const workChapter=workPage.querySelector('.authors-chapter');
  const workMedia=workPage.querySelector('.authors-video-frame');
  const workTitle=workPage.querySelector('.authors-work-title');
  const workParagraphs=[...workPage.querySelectorAll('.authors-work-copy p')];
  const enginePage=root.querySelector('.authors-engine-page');
  const engineParts=[...enginePage.querySelectorAll('[data-engine-reveal]')];
  const video=root.querySelector('[data-authors-video]');
  video.src=assets.blenderVideo;video.poster=assets.blenderPoster;video.muted=true;video.loop=true;video.controls=false;
  video.addEventListener('loadedmetadata',()=>video.setAttribute('data-media-state','ready'));
  video.addEventListener('playing',()=>video.setAttribute('data-media-state','playing'));
  video.addEventListener('pause',()=>video.setAttribute('data-media-state','paused'));
  video.addEventListener('error',()=>video.setAttribute('data-media-state','error'));
  let videoFrameTicket=0;
  function prepareVideo() {
    const ticket=++videoFrameTicket;
    video.setAttribute('data-first-frame','pending');
    const reveal=()=>{if(ticket===videoFrameTicket)video.setAttribute('data-first-frame','ready');};
    // The poster stays underneath until an actual decoded video frame exists.
    // Media decoding never blocks the page's shared animation clock.
    if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(reveal);
    else if(video.readyState>=2)reveal();
    else video.addEventListener('loadeddata',reveal,{once:true});
    video.play().catch(()=>{});
  }
  const assetImages=[...root.querySelectorAll('[data-authors-asset]')];
  assetImages.forEach(image=>{image.src=assets[image.dataset.authorsAsset];});
  const ready=Promise.all([...assetImages.map(image=>image.decode().catch(()=>{})),document.fonts?document.fonts.ready:Promise.resolve()]);
  const authors={};
  for(const page of root.querySelectorAll('[data-author]')) {
    const shade=document.createElement('div');shade.className='authors-page-depth';shade.setAttribute('aria-hidden','true');page.appendChild(shade);
    authors[page.dataset.author]={page,shade,bio:page.querySelector('.authors-bio'),read:page.querySelector('.authors-read')};
  }
  // The cover and its first sheet are separate objects. Both sides of the sheet
  // bend together, then the original live page returns when motion has settled.
  const paperLeaf=document.createElement('div');paperLeaf.className='authors-paper-leaf';
  const paperFront=document.createElement('div');paperFront.className='authors-paper-front';
  const paperTexture=document.createElement('img');paperTexture.className='authors-texture';paperTexture.alt='';paperTexture.src=assets.background;
  paperFront.appendChild(paperTexture);
  const paperBack=document.createElement('div');paperBack.className='authors-paper-back';
  paperBack.appendChild(authors.frontend.page);paperLeaf.appendChild(paperFront);paperLeaf.appendChild(paperBack);
  book.insertBefore(paperLeaf,coverLeaf);
  const coverEdge=document.createElement('div');coverEdge.className='authors-cover-edge';coverEdge.setAttribute('aria-hidden','true');coverLeaf.appendChild(coverEdge);
  const cast=document.createElement('div');cast.className='authors-paper-cast';cast.setAttribute('aria-hidden','true');book.insertBefore(cast,paperLeaf);
  function makeSheetMesh(host,frontArt,backArt) {
    const surface=document.createElement('div');surface.className='authors-sheet-mesh';surface.hidden=true;surface.inert=true;surface.setAttribute('aria-hidden','true');
    const count=18,width=418/count,strips=[],frontCopies=[],backCopies=[];
    function faceCopy(art,index,isBack) {
      const face=document.createElement('div');face.className='authors-facet-face'+(isBack?' authors-facet-back':'');
      const copy=art.cloneNode(true);copy.classList.add('authors-facet-art');copy.style.left=`${-index*width}px`;copy.style.top='0';copy.style.transform='none';copy.style.visibility='';
      copy.removeAttribute('data-author');copy.removeAttribute('aria-labelledby');
      copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      copy.querySelectorAll('[aria-labelledby]').forEach(node=>node.removeAttribute('aria-labelledby'));
      copy.querySelectorAll('[data-author]').forEach(node=>node.removeAttribute('data-author'));
      copy.querySelectorAll('.authors-read').forEach(button=>button.remove());
      const light=document.createElement('div');light.className='authors-facet-light';
      face.appendChild(copy);face.appendChild(light);(isBack?backCopies:frontCopies).push(copy);
      return {face,light};
    }
    for(let index=0;index<count;index++) {
      const strip=document.createElement('div');strip.className='authors-facet';strip.style.width=`${width+.35}px`;
      const front=faceCopy(frontArt,index,false);strip.appendChild(front.face);
      const back=backArt?faceCopy(backArt,count-1-index,true):null;
      if(back)strip.appendChild(back.face);
      surface.appendChild(strip);strips.push({strip,index,front,back});
    }
    host.appendChild(surface);return {surface,strips,width,frontCopies,backCopies};
  }
  const paperMesh=makeSheetMesh(paperLeaf,paperFront,authors.frontend.page);
  const frontendBadge=authors.frontend.page.querySelector('.authors-badge-row');
  const frontendRoleWords=[...authors.frontend.page.querySelectorAll('.authors-role-word')];
  const frontendParagraphs=[...authors.frontend.bio.querySelectorAll('p')];
  const frontendPortrait=authors.frontend.page.querySelector('.authors-portrait');
  const backendBadge=authors.backend.page.querySelector('.authors-badge-row');
  const backendRoleWords=[...authors.backend.page.querySelectorAll('.authors-role-word')];
  const backendParagraphs=[...authors.backend.bio.querySelectorAll('p')];
  const backendPortrait=authors.backend.page.querySelector('.authors-portrait');
  // One portrait and one set of labels remain on the page throughout the move.
  // There is no photo replacement, layout crossfade or text-size reflow.
  const movingLayers=[camera,paperLeaf,gutter,authors.backend.page,workPage,frontendPortrait,frontendBadge,...frontendRoleWords,backendPortrait,backendBadge,...backendRoleWords,workMedia];
  const revealLayers=[...frontendParagraphs,...backendParagraphs,workChapter,workTitle,...workParagraphs,...engineParts];
  movingLayers.forEach(element=>{element.style.willChange='transform';});
  screen.setAttribute('data-photo-mode','continuous');
  screen.setAttribute('data-motion-version','3');
  function bendSheet(mesh,angle,bend,active) {
    if(mesh.surface.hidden!==!active)mesh.surface.hidden=!active;
    if(!active)return;
    const point=u=>Math.abs(bend)<.00001?{x:418*u*Math.cos(angle),z:-418*u*Math.sin(angle)}:{x:418/bend*(Math.sin(angle+bend*u)-Math.sin(angle)),z:418/bend*(Math.cos(angle+bend*u)-Math.cos(angle))};
    for(const {strip,index,front,back} of mesh.strips) {
      const a=point(index/18),b=point((index+1)/18),dx=b.x-a.x,dz=b.z-a.z;
      const turn=Math.atan2(-dz,dx),length=Math.hypot(dx,dz);
      strip.style.transform=`translate3d(${a.x}px,0,${a.z}px) rotateY(${turn}rad) scaleX(${length/mesh.width})`;
      const shade=Math.min(.16,.09*Math.abs(Math.sin(turn))+.035*Math.abs(bend)*index/18);
      front.light.style.background=`linear-gradient(180deg,rgba(54,36,18,${shade*.55}),rgba(54,36,18,${shade}))`;
      if(back)back.light.style.background=front.light.style.background;
    }
  }
  const names={frontend:'Sehaj Khaira',backend:'Santa Singh'};
  const poses={cover:{open:0,focus:0,side:-1,work:0,withdraw:0,reveal:0,showcase:0},spread:{open:1,focus:0,side:-1,work:0,withdraw:0,reveal:0,showcase:0},frontend:{open:1,focus:1,side:-1,work:1,withdraw:1,reveal:1,showcase:1},backend:{open:1,focus:1,side:1,work:0,withdraw:0,reveal:1,showcase:0}};
  const tuning={durationMs:2350,openingMs:2850,focusZoom:21.5};
  let view='cover',target='cover',running=false,raf=0,started=0,duration=1500;
  let pose={...poses.cover},from={...pose},to={...pose},lastSelected='frontend';
  let frameIntervals=[],previousFrame=0;
  let nativeAnimations=[];
  let lastOpen=NaN;
  const clamp=value=>Math.max(0,Math.min(1,value));
  const phase=(value,start,end)=>clamp((value-start)/(end-start));
  const wave=value=>value===0||value===1?0:Math.sin(Math.PI*value);
  const minimumJerk=time=>{const t=clamp(time);return t*t*t*(10+t*(6*t-15));};
  function glide(time) {
    const x=clamp(time);
    if(x===0||x===1) return x;
    const curve=(t,a,b)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
    let low=0,high=1,t=x;
    for(let i=0;i<18;i++){t=(low+high)/2;if(curve(t,.30,.18)<x)low=t;else high=t;}
    return curve(t,.02,1);
  }
  function resize(){world.style.transform=`scale(${screen.clientWidth/1376})`;}
  function profileStyles(progress,roleStart,tilt,badgeShrink,count,labelShift=106) {
    const portraitMove=minimumJerk(phase(progress,0,.50));
    const labelX=minimumJerk(phase(progress,.04,.36));
    const labelY=minimumJerk(phase(progress,.22,.66));
    return {
      portrait:`translate3d(${-67*portraitMove}px,${-18.5*portraitMove}px,0) rotate(${tilt}deg) scale(${1-26/226*portraitMove},${1-21/230*portraitMove})`,
      badge:`translate3d(${labelShift*labelX}px,${-223*labelY}px,0) scale(${1-badgeShrink*labelX})`,
      roles:roleStart.map((x,index)=>`translate3d(${x+(labelShift-x)*labelX}px,${-216*labelY+index*(17.04*labelX+10*wave(labelX))}px,0) translateX(-50%) scale(${1-.1125*labelX})`),
      bio:Array.from({length:count},(_,index)=>{
        const value=minimumJerk(phase(progress,.59+index*.020,.90+index*.020));
        return {opacity:value,transform:`translate3d(0,${16*(1-value)}px,0)`};
      })
    };
  }
  function focusStyles(state) {
    const {open,focus,side,work,withdraw,reveal,showcase}=state;
    const front=clamp(focus*(1-side)/2),backFocus=clamp(focus*(1+side)/2);
    const zoom=1+.025*open+(tuning.focusZoom/100-.025)*focus;
    const retreat=wave(withdraw);
    const frontProfile=profileStyles(reveal*(1-side)/2,[-100.8,-4.8,96],-2.3,.125,frontendParagraphs.length);
    const backProfile=profileStyles(reveal*(1+side)/2,[-100.8,-9.6,91.2],2,.20,backendParagraphs.length,115);
    const media=minimumJerk(phase(showcase,.22,.64));
    const chapter=minimumJerk(phase(showcase,.20,.61));
    const title=minimumJerk(phase(showcase,.58,.88));
    const copy=workParagraphs.map((_,index)=>minimumJerk(phase(showcase,.65+index*.07,.96+index*.04)));
    const engineProgress=reveal*(1+side)/2;
    return {
      // Keep the complete spread centered as either author's details come forward.
      camera:`translate3d(${-4*(1-open)}px,${-31-5*open}px,0) scale(${zoom})`,
      paper:`translate3d(${425*backFocus}px,${5*backFocus}px,${.4+26*front-14*backFocus}px) rotateY(-180deg)`,
      binding:`translate3d(0,0,${4.7+22*front+26*backFocus}px)`,
      backend:`translate3d(${-425*withdraw}px,${5*withdraw-8*retreat}px,${.5+4*open+26*backFocus-3*withdraw}px) rotateY(${-2*retreat}deg) rotateZ(${-0.85*withdraw-.6*retreat}deg)`,
      // The showcase stays below the outgoing sheet, above the page stack.
      // Neither surface crosses the other's depth plane during the handoff.
      work:`translate3d(${8*(1-work)}px,${22*(1-work)}px,1.2px) rotateZ(${.2*(1-work)}deg) scale(${.995+.005*work})`,
      workOpacity:minimumJerk(phase(showcase,.08,.50)),
      portrait:frontProfile.portrait,badge:frontProfile.badge,roles:frontProfile.roles,bio:frontProfile.bio,
      backendPortrait:backProfile.portrait,backendBadge:backProfile.badge,backendRoles:backProfile.roles,backendBio:backProfile.bio,
      engineOpacity:minimumJerk(phase(backFocus,.08,.46)),
      engine:engineParts.map((_,index)=>{const value=minimumJerk(phase(engineProgress,.16+index*.09,.56+index*.10));return {opacity:value,transform:`translate3d(0,${14*(1-value)}px,0)`};}),
      mediaOpacity:media,mediaTransform:`translate3d(0,${18*(1-media)}px,0)`,
      chapterOpacity:chapter,chapterTransform:`translate3d(0,${10*(1-chapter)}px,0)`,
      titleOpacity:title,titleTransform:`translate3d(0,${14*(1-title)}px,0)`,
      copy:copy.map(value=>({opacity:value,transform:`translate3d(0,${14*(1-value)}px,0)`})),
      readOpacity:1-minimumJerk(phase(focus,0,.12)),
      frontendShade:.14*backFocus,backendShade:.14*front
    };
  }
  function render() {
    const {open,focus,side,work,withdraw}=pose;
    const frontendFocus=clamp(focus*(1-side)/2),backendFocus=clamp(focus*(1+side)/2);
    const visual=focusStyles(pose);
    frontendPortrait.style.transform=visual.portrait;
    frontendBadge.style.transform=visual.badge;
    frontendRoleWords.forEach((element,index)=>{element.style.transform=visual.roles[index];});
    backendPortrait.style.transform=visual.backendPortrait;
    backendBadge.style.transform=visual.backendBadge;
    backendRoleWords.forEach((element,index)=>{element.style.transform=visual.backendRoles[index];});
    const paintReveal=(element,values)=>{element.style.opacity=String(values.opacity);element.style.transform=values.transform;};
    frontendParagraphs.forEach((element,index)=>paintReveal(element,visual.bio[index]));
    backendParagraphs.forEach((element,index)=>paintReveal(element,visual.backendBio[index]));
    paintReveal(workMedia,{opacity:visual.mediaOpacity,transform:visual.mediaTransform});
    paintReveal(workChapter,{opacity:visual.chapterOpacity,transform:visual.chapterTransform});
    paintReveal(workTitle,{opacity:visual.titleOpacity,transform:visual.titleTransform});
    workParagraphs.forEach((element,index)=>paintReveal(element,visual.copy[index]));
    enginePage.style.opacity=String(visual.engineOpacity);
    engineParts.forEach((element,index)=>paintReveal(element,visual.engine[index]));
    const coverOpen=glide(phase(open,0,.82));
    const paperOpen=glide(phase(open,.12,1));
    camera.style.transform=visual.camera;
    gutter.style.transform=visual.binding;
    if(open!==lastOpen){
      // Keep the inner sheet behind the leather spine while the cover is closed.
      // Restore its full edge during opening so the open spread stays seamless.
      root.style.setProperty('--authors-spine-inset',`${20*(1-minimumJerk(phase(open,.08,.36)))}px`);
      book.style.transform=`translate3d(${474+214*open}px,0,0) rotateX(${3.2-1.6*open}deg) rotateY(${-5.5+5.5*open}deg) rotateZ(${-0.6+.6*open}deg)`;
      coverLeaf.style.transform=`translateZ(${-2*coverOpen}px) rotateY(${-181.2*coverOpen}deg)`;
      gutter.style.opacity=hingePaper.style.opacity=String(minimumJerk(phase(open,.70,1)));lastOpen=open;
    }
    for(const [key,entry] of Object.entries(authors)) {
      const weight=key==='frontend'?(1-side)/2:(1+side)/2;
      const detail=clamp(focus*weight);
      entry.shade.style.opacity=String(.14*focus*(1-weight));
      const hideBio=detail===0&&!(running&&(view===key||target===key));
      if(entry.bio.hidden!==hideBio)entry.bio.hidden=hideBio;
      entry.bio.style.opacity='1';entry.bio.style.transform='none';
      entry.read.style.opacity=String(visual.readOpacity);
    }
    const openingCurl=.52*wave(paperOpen);
    const paperBends=openingCurl>.0005;
    const paperDepth=.4+26*frontendFocus-14*backendFocus;
    const paperPosition=`translate3d(${425*backendFocus}px,${5*backendFocus}px,${paperDepth}px)`;
    paperLeaf.style.transform=paperBends?paperPosition:`${paperPosition} rotateY(${-180*paperOpen}deg)`;
    paperFront.style.visibility=paperBends?'hidden':'';paperBack.style.visibility=paperBends?'hidden':'';
    bendSheet(paperMesh,-Math.PI*paperOpen-.28*openingCurl,openingCurl,paperBends);
    authors.backend.page.style.transform=visual.backend;
    const castWave=wave(paperOpen);
    cast.style.left=`${7+Math.max(0,418*Math.cos(Math.PI*paperOpen)-65)}px`;
    cast.style.width=`${65+25*castWave}px`;cast.style.opacity=String(.26*castWave);
    const turnValue=paperOpen.toFixed(3),turnPhase=paperOpen>.15&&paperOpen<.9?'moving':paperOpen===1?'settled':'start';
    if(screen.getAttribute('data-paper-turn')!==turnValue)screen.setAttribute('data-paper-turn',turnValue);
    if(screen.getAttribute('data-turn-phase')!==turnPhase)screen.setAttribute('data-turn-phase',turnPhase);
    workPage.style.opacity=String(visual.workOpacity);
    workPage.style.transform=visual.work;
    const workPhase=work===0?'hidden':work===1?'settled':'lifting';
    if(screen.getAttribute('data-work-phase')!==workPhase)screen.setAttribute('data-work-phase',workPhase);
  }
  function finish() {
    view=target;pose={...poses[view]};running=false;render();raf=0;
    const ended=nativeAnimations;nativeAnimations=[];ended.forEach(animation=>animation.cancel());
    // Keep the photo and page surfaces on the same composited layers at rest.
    // Removing their backing layers at the last frame can cause a visible flash.
    [book,coverLeaf,...revealLayers,...Object.values(authors).map(entry=>entry.shade)].forEach(element=>{element.style.willChange='auto';});
    if(screen.getAttribute('data-motion-engine')==='frame-loop'){
      screen.setAttribute('data-motion-frames',String(frameIntervals.length));
      screen.setAttribute('data-motion-long-frames',String(frameIntervals.filter(delta=>delta>34).length));
    }else{
      screen.removeAttribute('data-motion-frames');screen.removeAttribute('data-motion-long-frames');
    }
    cover.disabled=view!=='cover';cover.setAttribute('aria-hidden',view==='cover'?'false':'true');
    for(const [key,entry] of Object.entries(authors)) {
      const visible=view==='spread'||view===key;
      entry.page.inert=!visible;entry.page.setAttribute('aria-hidden',visible?'false':'true');
      entry.read.hidden=view!=='spread';entry.read.disabled=entry.read.hidden;
      entry.bio.setAttribute('aria-hidden',view===key?'false':'true');
    }
    back.hidden=view==='cover';back.setAttribute('aria-label',view==='spread'?'Close the book':'Back to the authors spread');
    workPage.inert=view!=='frontend';workPage.setAttribute('aria-hidden',view==='frontend'?'false':'true');
    enginePage.inert=view!=='backend';enginePage.setAttribute('aria-hidden',view==='backend'?'false':'true');
    if(view==='frontend')video.play().catch(()=>{});else {videoFrameTicket++;video.pause();video.currentTime=0;}
    screen.setAttribute('data-view',view);screen.removeAttribute('aria-busy');
    status.textContent=view==='cover'?'Click the book to meet its creators.':view==='spread'?'Sehaj Khaira, Convenor and Frontend Developer, on the left. Santa Singh, Co-Convenor and Backend Developer, on the right. Click either portrait to read their introduction.':`${names[view]}. ${authors[view].bio.textContent}`;
    (view==='cover'?cover:view==='spread'?authors[lastSelected].read:back).focus({preventScroll:true});
    root.dispatchEvent(new CustomEvent('bookshelf:view',{detail:{view}}));
  }
  function tick(now) {
    const time=clamp((now-started)/duration),ease=from.open!==to.open?glide(time):minimumJerk(time);
    if(previousFrame)frameIntervals.push(now-previousFrame);previousFrame=now;
    for(const key of ['open','focus','side'])pose[key]=from[key]+(to[key]-from[key])*ease;
    for(const key of ['reveal','showcase'])pose[key]=from[key]+(to[key]-from[key])*time;
    // Two overlapping tracks: the outgoing sheet makes room first, while the
    // incoming sheet lifts and has slightly longer to settle. Both stop gently.
    const entering=to.work>from.work;
    const workEase=minimumJerk(phase(time,entering ? .10 : 0,entering ? .86 : .90));
    const retreatEase=minimumJerk(phase(time,entering ? 0 : .10,entering ? .90 : 1));
    pose.work=from.work+(to.work-from.work)*workEase;
    pose.withdraw=from.withdraw+(to.withdraw-from.withdraw)*retreatEase;
    render();if(time<1)raf=requestAnimationFrame(tick);else finish();
  }
  async function animateFocus() {
    const entering=to.work>from.work;
    const frames=Array.from({length:121},(_,index)=>{
      const offset=index/120,ease=minimumJerk(offset),state={...from};
      for(const key of ['open','focus','side'])state[key]=from[key]+(to[key]-from[key])*ease;
      for(const key of ['reveal','showcase'])state[key]=from[key]+(to[key]-from[key])*offset;
      state.work=from.work+(to.work-from.work)*minimumJerk(phase(offset,entering ? .10 : 0,entering ? .86 : .90));
      state.withdraw=from.withdraw+(to.withdraw-from.withdraw)*minimumJerk(phase(offset,entering ? 0 : .10,entering ? .90 : 1));
      return {offset,...focusStyles(state)};
    });
    const tracks=[];
    function track(element,properties,selectFrame=frame=>frame) {
      const keyframes=frames.map(frame=>{
        const values={offset:frame.offset};
        const source=selectFrame(frame);
        for(const [property,key] of Object.entries(properties))values[property]=source[key];
        return values;
      });
      tracks.push(element.animate(keyframes,{duration,easing:'linear',fill:'both'}));
    }
    track(camera,{transform:'camera'});track(paperLeaf,{transform:'paper'});track(gutter,{transform:'binding'});
    track(authors.backend.page,{transform:'backend'});track(workPage,{transform:'work',opacity:'workOpacity'});
    track(frontendPortrait,{transform:'portrait'});
    track(frontendBadge,{transform:'badge'});
    frontendRoleWords.forEach((element,index)=>track(element,{transform:'transform'},frame=>({transform:frame.roles[index]})));
    frontendParagraphs.forEach((element,index)=>track(element,{opacity:'opacity',transform:'transform'},frame=>frame.bio[index]));
    track(backendPortrait,{transform:'backendPortrait'});
    track(backendBadge,{transform:'backendBadge'});
    backendRoleWords.forEach((element,index)=>track(element,{transform:'transform'},frame=>({transform:frame.backendRoles[index]})));
    backendParagraphs.forEach((element,index)=>track(element,{opacity:'opacity',transform:'transform'},frame=>frame.backendBio[index]));
    track(workMedia,{opacity:'mediaOpacity',transform:'mediaTransform'});
    track(workChapter,{opacity:'chapterOpacity',transform:'chapterTransform'});
    track(workTitle,{opacity:'titleOpacity',transform:'titleTransform'});
    workParagraphs.forEach((element,index)=>track(element,{opacity:'opacity',transform:'transform'},frame=>frame.copy[index]));
    track(enginePage,{opacity:'engineOpacity'});
    engineParts.forEach((element,index)=>track(element,{opacity:'opacity',transform:'transform'},frame=>frame.engine[index]));
    Object.values(authors).forEach(entry=>track(entry.read,{opacity:'readOpacity'}));
    track(authors.frontend.shade,{opacity:'frontendShade'});track(authors.backend.shade,{opacity:'backendShade'});
    nativeAnimations=tracks;
    // Every track shares one document clock, including the camera and video page.
    const commonStart=document.timeline.currentTime;
    tracks.forEach(animation=>{animation.startTime=commonStart;});
    screen.setAttribute('data-motion-engine','native');
    screen.setAttribute('data-work-phase','lifting');
    await Promise.allSettled(tracks.map(animation=>animation.finished));
    if(running&&nativeAnimations===tracks)finish();
  }
  async function transition(next) {
    if(running||next===view||!poses[next])return;
    if(view==='cover'&&next!=='spread')return;
    running=true;target=next;from={...pose};to={...poses[next]};
    if(next==='frontend'||next==='backend')lastSelected=next;
    if(view==='spread'&&(next==='frontend'||next==='backend'))from.side=to.side;
    // On the return, retain the selected side until the camera has widened.
    if(next==='spread')to.side=pose.side;
    duration=next==='cover'||view==='cover'?tuning.openingMs:tuning.durationMs*1.26;
    cover.disabled=true;back.hidden=true;
    workPage.inert=true;enginePage.inert=true;enginePage.setAttribute('aria-hidden','true');if(next!=='frontend')video.pause();
    for(const entry of Object.values(authors)){entry.page.inert=true;entry.read.disabled=true;entry.read.hidden=from.open!==to.open;}
    screen.setAttribute('aria-busy','true');
    status.textContent=next==='cover'?'Closing the book.':next==='spread'?'Opening the authors spread.':`Reading ${names[next]}’s introduction.`;
    await ready;
    if(!running)return;
    if(next==='frontend')prepareVideo();
    frameIntervals=[];previousFrame=0;
    if(reduced.matches){finish();return;}
    [camera,book,coverLeaf,paperLeaf,authors.backend.page].forEach(element=>{element.style.willChange='transform';});
    movingLayers.forEach(element=>{element.style.willChange='transform';});
    revealLayers.forEach(element=>{element.style.willChange='transform, opacity';});
    Object.values(authors).forEach(entry=>{entry.shade.style.willChange='opacity';});
    render();
    // Prepare the page layers before starting the visible movement.
    await new Promise(resolve=>requestAnimationFrame(resolve));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    if(!running)return;
    if(reduced.matches){finish();return;}
    if(from.open===to.open&&camera.animate){
      animateFocus();return;
    }
    screen.setAttribute('data-motion-engine','frame-loop');
    started=performance.now();raf=requestAnimationFrame(tick);
  }
  cover.addEventListener('click',()=>transition('spread'));
  for(const [key,entry] of Object.entries(authors))entry.read.addEventListener('click',()=>transition(key));
  back.addEventListener('click',()=>transition(view==='spread'?'cover':'spread'));
  reduced.addEventListener('change',()=>{if(reduced.matches&&running&&(raf||nativeAnimations.length)){cancelAnimationFrame(raf);finish();}});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);if(running)finish();video.pause();});
  new ResizeObserver(resize).observe(screen);resize();render();
  function reset() {
    cancelAnimationFrame(raf);
    target='cover';
    finish();
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)video.pause();
    else if(view==='frontend'&&root.isConnected&&!root.closest('[inert]'))video.play().catch(()=>{});
  });
  root.addEventListener('bookshelf:open',()=>transition('spread'));
  root.addEventListener('bookshelf:close',()=>transition('cover'));
  return {ready, reset, get view(){return view;}, get running(){return running;}};
}
