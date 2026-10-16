export function messageParts(text: string) {
    return text.split(/(https?:\/\/[^\s<>]+|:[a-z0-9_]{2,32}:)/gi).filter(Boolean).flatMap(part => {
        if (!/^https?:\/\//i.test(part)) return [{ text: part, link: false }];
        const link = part.replace(/[.,!?;:]+$/, '').replace(/\)+$/, suffix => suffix.slice(0, Math.max(0, suffix.length - Math.max(0, (part.match(/\)/g)?.length || 0) - (part.match(/\(/g)?.length || 0)))) );
        try {
            const url = new URL(link);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [{text:part,link:false}];
            return [{text:link,link:true}, ...(part.length > link.length ? [{text:part.slice(link.length),link:false}] : [])];
        } catch { return [{text:part,link:false}]; }
    });
}
