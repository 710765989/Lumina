import {createContext,useContext} from 'react';

// Keep page navigation/filter/scroll state, but let hidden pages release decoded
// image surfaces and automatic players. The same DOM nodes are reused on return.
export const MediaActivity=createContext(true);
export const useMediaActivity=()=>useContext(MediaActivity);
