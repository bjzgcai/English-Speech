(() => {
  const header = document.querySelector('.app-nav, .docs-nav');
  const panel = header?.querySelector('.header-menu');
  if (!panel) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mobile-menu-toggle';
  toggle.innerHTML = '<span>Menu</span><span class="mobile-menu-chevron" aria-hidden="true"></span>';
  panel.id = 'headerMenu';
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded', 'false');
  header.insertBefore(toggle, panel);
  header.classList.add('has-mobile-menu');

  const mobile = window.matchMedia('(max-width: 820px)');
  function close(restoreFocus = false) {
    header.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('a, #logoutButton, [data-logout-button]')) close(mobile.matches);
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && header.classList.contains('menu-open')) {
      close(true);
      event.preventDefault();
    }
  });
  header.addEventListener('focusout', event => {
    if (!header.contains(event.relatedTarget)) close();
  });
  mobile.addEventListener('change', () => close());
})();
