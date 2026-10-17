export function Icon({name}:{name:'collapse'|'more'|'back'|'chevron'|'code'|'external'}) {
  return <svg className="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name==='collapse' || name==='chevron' ? <path d="m7 10 5 5 5-5"/> : name==='back' ? <path d="m14 6-6 6 6 6"/> : name==='code' ? <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 12"/> : name==='external' ? <path d="M14 4h6v6m0-6L10 14m0-10H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/> : <><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/></>}
  </svg>;
}
