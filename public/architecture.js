(() => {
  const tabs = Array.from(document.querySelectorAll(".stage-tab[data-stage]"));
  const panels = Array.from(document.querySelectorAll(".stage-panel[data-panel]"));

  function activateStage(stage, moveFocus = false) {
    const selectedTab = tabs.find(tab => tab.dataset.stage === stage);
    const selectedPanel = panels.find(panel => panel.dataset.panel === stage);
    if (!selectedTab || !selectedPanel) return;

    for (const tab of tabs) {
      const selected = tab === selectedTab;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel !== selectedPanel;
    }

    if (moveFocus) selectedTab.focus();
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => activateStage(tab.dataset.stage));
    tab.addEventListener("keydown", event => {
      const current = tabs.indexOf(tab);
      let next = current;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % tabs.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      activateStage(tabs[next].dataset.stage, true);
    });
  }

  const revealItems = Array.from(document.querySelectorAll(".reveal"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || !("IntersectionObserver" in window)) {
    for (const item of revealItems) item.classList.add("is-visible");
    return;
  }

  document.documentElement.classList.add("motion-ready");
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

  for (const item of revealItems) observer.observe(item);
})();
