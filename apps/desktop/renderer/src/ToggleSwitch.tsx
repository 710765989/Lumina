import {ActionButton} from './ActionControls';
export function ToggleSwitch({checked,onChange,label,disabled=false}:{checked:boolean;onChange:()=>void;label:string;disabled?:boolean}){
 return <ActionButton type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`toggle-switch${checked?' is-on':''}`} onClick={onChange}><span className="toggle-switch-label" aria-hidden="true">{checked?'ON':'OFF'}</span><span className="toggle-switch-thumb" aria-hidden="true"/></ActionButton>;
}
