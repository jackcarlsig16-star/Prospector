const CYAN  = '#00F5FF';
const AMBER = '#FFB800';
const RED   = '#FF4444';
const MUTE  = '#555566';

export let BDR_LIST = [];
export const setBdrList = (list) => { BDR_LIST = list; };

export const URGENCY_OPTIONS = [
  { id:"hot",      emoji:"🔴", label:"Hot",       sub:"Reach out today",    color:RED,   frontierPriority:"Top",  taskPriority:"High",   dueDays:0  },
  { id:"warm",     emoji:"🟠", label:"Warm",      sub:"This week",          color:AMBER, frontierPriority:"Mid",  taskPriority:"High",   dueDays:3  },
  { id:"followup", emoji:"🟡", label:"Follow Up", sub:"Within 2 weeks",     color:CYAN,  frontierPriority:"Mid",  taskPriority:"Medium", dueDays:14 },
  { id:"low",      emoji:"⚪", label:"Low",        sub:"When you get to it", color:MUTE,  frontierPriority:"Low",  taskPriority:"Low",    dueDays:30 },
];
