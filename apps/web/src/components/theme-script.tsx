export function ThemeScript() {
  const code = `try{var t=localStorage.getItem('ember-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
