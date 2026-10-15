// Table Themes: each entry is a background image in assets/ that players can pick.
// To add a theme, upload the image to assets/ and add one line here. The first entry is the default.
const TABLE_THEMES = [
  {id: 'cairo-sunset', file: 'CAIRO BACKGROUND TEST 3.png', name: 'Cairo Sunset', description: 'The Nile and the pyramids at sunset.'},
  {id: 'cairo-overcast', file: 'CAIRO BACKGROUND (OVERCAST) TEST 1.png', name: 'Cairo Overcast', description: 'The same terrace under a stormy sky.'},
  {id: 'original', file: 'ORIGINAL Background test 1.png', name: 'Original', description: 'The classic black and gold table.'},
];

(function(){
  const KEY = 'rivlTableTheme';
  const url = t => 'assets/' + encodeURIComponent(t.file);
  function saved(){ try { return localStorage.getItem(KEY) } catch(e) { return null } }
  function current(){ return TABLE_THEMES.find(t => t.id === saved()) || TABLE_THEMES[0] }

  function apply(theme){
    document.documentElement.style.setProperty('--table-bg', `url("${url(theme)}")`);
  }

  function render(){
    const grid = document.querySelector('#themes .theme-grid');
    if (!grid) return;
    grid.querySelectorAll('.table-theme').forEach(el => el.remove());
    const chosen = current();
    TABLE_THEMES.slice().reverse().forEach(theme => {
      const card = document.createElement('div');
      card.className = 'panel table-theme' + (theme === chosen ? ' chosen' : '');
      const preview = document.createElement('div');
      preview.className = 'theme-preview theme-photo';
      preview.style.backgroundImage = `url("${url(theme)}")`;
      const title = document.createElement('h3');
      title.textContent = theme.name;
      const text = document.createElement('p');
      text.textContent = theme.description;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = theme === chosen ? 'outline' : 'gold';
      button.textContent = theme === chosen ? 'IN USE' : 'SELECT';
      button.disabled = theme === chosen;
      button.onclick = () => { try { localStorage.setItem(KEY, theme.id) } catch(e) {} apply(theme); render() };
      card.append(preview, title, text, button);
      grid.prepend(card);
    });
  }

  apply(current());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
