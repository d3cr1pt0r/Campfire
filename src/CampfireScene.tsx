/** Decorative, scalable firelight illustration for the welcome screen. */
export function CampfireScene() {
    return (
        <svg className="campfire-scene" viewBox="0 0 480 240" fill="none" aria-hidden="true">
            <defs>
                <radialGradient id="firelight">
                    <stop stopColor="#edaa60" stopOpacity=".26" />
                    <stop offset="1" stopColor="#edaa60" stopOpacity="0" />
                </radialGradient>
                <linearGradient
                    id="flame"
                    x1="240"
                    y1="105"
                    x2="240"
                    y2="196"
                    gradientUnits="userSpaceOnUse"
                >
                    <stop stopColor="#ffe2a0" />
                    <stop offset="1" stopColor="#e37e45" />
                </linearGradient>
            </defs>
            <ellipse cx="240" cy="151" rx="172" ry="115" fill="url(#firelight)" />
            <path
                d="M5 199C81 164 105 179 160 192C232 211 275 171 337 180C395 189 421 170 475 190"
                stroke="#baa17a"
                strokeOpacity=".18"
            />
            <path
                d="M18 219C104 185 158 226 229 219C330 208 364 195 462 215"
                stroke="#baa17a"
                strokeOpacity=".12"
            />
            <g fill="#7f9479" fillOpacity=".32">
                <path d="M75 54L53 103H65L43 142H60L36 182H114L90 142H106L84 103H97L75 54Z" />
                <path d="M400 65L381 109H392L369 150H384L363 185H437L416 150H432L409 109H419L400 65Z" />
            </g>
            <g fill="#8a997e" fillOpacity=".16">
                <path d="M126 96L108 137H119L98 175H154L135 137H145L126 96Z" />
                <path d="M354 96L337 133H347L327 172H380L362 133H373L354 96Z" />
            </g>
            <ellipse cx="240" cy="207" rx="67" ry="11" fill="#edaa60" fillOpacity=".12" />
            <path
                d="M210 197L266 214M212 213L268 196"
                stroke="#af704a"
                strokeWidth="12"
                strokeLinecap="round"
            />
            <path
                d="M240 101C243 128 274 143 269 168C267 184 254 193 240 193C218 193 205 181 208 163C210 151 220 143 221 131C228 136 231 143 230 149C245 132 241 117 240 101Z"
                fill="url(#flame)"
            />
            <path
                d="M240 150C241 163 256 170 250 181C246 189 234 189 229 183C224 174 236 165 240 150Z"
                fill="#fff1ce"
            />
            <g fill="#f7c886">
                <circle cx="230" cy="81" r="2" />
                <circle cx="254" cy="58" r="1.5" />
                <circle cx="260" cy="108" r="2" />
                <circle cx="160" cy="41" r="1" opacity=".5" />
                <circle cx="333" cy="35" r="1.5" opacity=".5" />
                <circle cx="105" cy="25" r="1" opacity=".5" />
            </g>
            <path d="M294 79a12 12 0 0012-17a13 13 0 11-12 17Z" fill="#ead2a1" fillOpacity=".6" />
        </svg>
    );
}
