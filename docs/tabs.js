"use strict";
(() => {
  const tabs=[document.getElementById("tab-decode"),document.getElementById("tab-create")];
  const panels=[document.getElementById("decode-panel"),document.getElementById("create-panel")];
  function select(index,focus=false){
    tabs.forEach((tab,i)=>{
      const active=i===index;
      tab.setAttribute("aria-selected",String(active));
      tab.tabIndex=active?0:-1;
      panels[i].hidden=!active;
    });
    if(focus)tabs[index].focus();
    if(window.location.hash !== (index ? "#create" : "#decode"))
      history.replaceState(null,"",index ? "#create" : "#decode");
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener("click",()=>select(index));
    tab.addEventListener("keydown",e=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;
      e.preventDefault();
      const next=e.key==="Home"?0:e.key==="End"?tabs.length-1:
        (index+(e.key==="ArrowRight"?1:tabs.length-1))%tabs.length;
      select(next,true);
    });
  });
  window.addEventListener("hashchange",()=>select(location.hash==="#create"?1:0));
  select(location.hash==="#create"?1:0);
})();