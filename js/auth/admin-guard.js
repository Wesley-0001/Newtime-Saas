/**
 * Guard para páginas admin standalone — mesma sessão que `app.js` (`cp_user`).
 */
export function requireAdmin() {
  let ok = false;
  try {
    const raw = sessionStorage.getItem('cp_user');
    if (!raw) {
      window.location.replace('../../app.html');
      throw new Error('NOT_ADMIN');
    }
    const user = JSON.parse(raw);
    ok = !!(user && user.role === 'admin');
  } catch (e) {
    if (e && e.message === 'NOT_ADMIN') throw e;
    ok = false;
  }
  if (!ok) {
    window.location.replace('../../app.html');
    throw new Error('NOT_ADMIN');
  }
}
