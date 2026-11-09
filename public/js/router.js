/**
 * AylusMusic - Hash Router
 */

class Router {
  constructor() {
    this.routes = {};
    this.currentRoute = '';
    this.currentParams = {};
    this.beforeNavigateHook = null;
  }

  register(path, handler) {
    this.routes[path] = handler;
  }

  setBeforeNavigate(hook) {
    this.beforeNavigateHook = hook;
  }

  init() {
    window.addEventListener('hashchange', () => this.handleHashChange());
    this.handleHashChange();
  }

  navigate(hash) {
    window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
  }

  handleHashChange() {
    let hash = window.location.hash.slice(1);
    if (!hash || hash === '/') {
      hash = '/home';
    }

    if (this.beforeNavigateHook) {
      const allow = this.beforeNavigateHook(hash);
      if (allow === false) return;
    }

    // Match routes
    for (const routePattern in this.routes) {
      const match = this.matchRoute(routePattern, hash);
      if (match) {
        this.currentRoute = routePattern;
        this.currentParams = match.params;
        this._updateNavHighlight(routePattern);
        this.routes[routePattern](match.params);
        return;
      }
    }

    // Fallback to home
    if (this.routes['/home']) {
      this.currentRoute = '/home';
      this.currentParams = {};
      this._updateNavHighlight('/home');
      this.routes['/home']({});
    }
  }

  matchRoute(pattern, path) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        const paramName = patternParts[i].slice(1);
        params[paramName] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return { params };
  }

  _updateNavHighlight(route) {
    const baseRoute = route.split('/')[1] || 'home';
    // Update desktop sidebar
    document.querySelectorAll('.desktop-sidebar .nav-link').forEach(link => {
      const target = link.getAttribute('data-route');
      link.classList.toggle('active', target === baseRoute);
    });

    // Update mobile bottom nav
    document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(item => {
      const target = item.getAttribute('data-route');
      item.classList.toggle('active', target === baseRoute);
    });
  }
}

export const router = new Router();
