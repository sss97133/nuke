# hand-check results (fresh random, excludes v35 spot-check vids and the 594 disagreements), seed 20261025
J={ # class: (correct, n, error sample indices)
'T_emb':(135,150,[7,8,36,54,70,93,94,99,118,119,124,126,133,135,144]),
'T_num':(139,150,[12,20,46,69,85,89,101,106,133,138,143]),
'T_bus':(150,150,[]),
'T_van':(144,150,[16,29,32,42,79,104]),
'T_make':(141,150,[17,44,64,94,96,119,134,145,149]),
'T_other':(148,150,[106,145]),
'R_tractor':(146,150,[57,72,98,120]),
'M_other':(143,150,[10,13,36,52,87,89,132]),
'M_neon':(None,120,'~80 Dodge/Plymouth Neon cars + Neon Orange/Green paint'),
'M_display':(135,150,[1,3,25,31,39,40,46,57,74,86,95,107,126,143,145]),
'M_toy':(None,127,'~84 toy tonneau cars, toy haulers, Grumpy\'s Toy race cars'),
'M_banner':(46,48,[26,42]),'M_bench':(9,27,'18 cars with bench seats'),'M_cabinet':(9,11,[0,4]),
'M_carousel':(12,13,[6]),'M_clock':(59,62,[14,43,52]),'M_cooler':(7,13,[0,2,4,6,7,11]),
'M_globe':(12,29,'Airstream Globetrotter/Dethleffs Globebus RVs, Chrysler 300C'),'M_lighted':(7,7,[]),
'T_word_delivery':(144,150,[16,53,71,97,104,129]),'T_word_jimmy':(149,150,[35]),
'T_word_scout':(146,150,[63,73,124,132]),'T_word_stake':(46,46,[]),
'T_word_panel':(133,150,[5,8,11,28,29,30,39,72,80,91,106,113,114,126,128,131,146]),
'T_word_semi':(None,92,'Jaguar semi-lightweight, semi-racers, boats, toys, trailers, guitars'),
'T_word_dump':(None,113,'~17 dump trailers (end/belly dump, Fruehauf, Hardee, Featherlite)'),
'RUN':(144,150,[23,39,89,101,111,135]),
}
BAD=['T_emb','T_num','T_make','T_word_panel','T_word_semi','T_word_dump','M_neon','M_display','M_toy','M_bench','M_cabinet','M_carousel','M_cooler','M_globe']
