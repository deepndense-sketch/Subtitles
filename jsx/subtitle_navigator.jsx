/* Subtitle PNG Navigator - Premiere Pro ExtendScript host functions */

function psnQuote(value) {
    var text = String(value === undefined || value === null ? "" : value);
    return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
}

function psnJson(object) {
    var parts = [];
    var key;
    for (key in object) {
        if (!object.hasOwnProperty || object.hasOwnProperty(key)) {
            var value = object[key];
            if (typeof value === "number" || typeof value === "boolean") parts.push(psnQuote(key) + ":" + String(value));
            else if (value === null) parts.push(psnQuote(key) + ":null");
            else parts.push(psnQuote(key) + ":" + psnQuote(value));
        }
    }
    return "{" + parts.join(",") + "}";
}

function psnError(message) { return psnJson({ ok: false, error: String(message || "Unknown error") }); }
function psnSeconds(time) { try { return Number(time.seconds); } catch (e) { return 0; } }
function psnTrackCount(tracks) { try { return Number(tracks.numTracks); } catch (e) { return 0; } }
function psnNormalizePath(value) { return String(value || "").replace(/\\/g, "/").toLowerCase(); }
function psnProjectItemPath(item) { try { return item && item.getMediaPath ? String(item.getMediaPath()) : ""; } catch (e) { return ""; } }
function psnItemName(item) {
    try { if (item.projectItem && item.projectItem.name) return String(item.projectItem.name); } catch (eProject) {}
    try { if (item.name) return String(item.name); } catch (eName) {}
    return "";
}
function psnSameItem(a, b) {
    if (!a || !b) return false;
    try { if (a.nodeId && b.nodeId) return a.nodeId === b.nodeId; } catch (e) {}
    return a === b;
}
// Plain snapshots, never cached TrackItem references. Re-resolve every operation.
var psnUndoHistory = [];
var psnRedoHistory = [];
var psnEpsilon = 0.000001;
function psnSequenceKey(sequence) {
    return String(app.project.path || "") + "|" + String(sequence.sequenceID);
}
function psnSnapshot(track) {
    var rows = [], clips = track.clips;
    for (var i = 0; i < clips.numItems; i++) {
        var c = clips[i];
        var row = { id: String(c.nodeId), start: psnSeconds(c.start), end: psnSeconds(c.end),
            item: c.projectItem ? String(c.projectItem.nodeId || c.projectItem.name) : "" };
        if (c.inPoint) row.inPoint = psnSeconds(c.inPoint);
        if (c.outPoint) row.outPoint = psnSeconds(c.outPoint);
        rows.push(row);
    }
    rows.sort(function(a,b) { return a.start - b.start || (a.id < b.id ? -1 : 1); });
    return rows;
}
function psnEqual(a,b) {
    if (a.length !== b.length) return false;
    for (var i=0; i<a.length; i++) {
        if (a[i].id !== b[i].id || a[i].item !== b[i].item) return false;
        var fields = ["start","end","inPoint","outPoint"];
        for(var j=0;j<fields.length;j++) {
            var x=a[i][fields[j]], y=b[i][fields[j]];
            if (x === undefined && y === undefined) continue;
            if (x === undefined || y === undefined || !isFinite(x) || !isFinite(y) || Math.abs(x-y)>psnEpsilon) return false;
        }
    }
    return true;
}
function psnCheckTrack(track, rows) {
    if (track.isLocked && track.isLocked()) throw Error("The subtitle track is locked.");
    var ids = {};
    for(var i=0;i<rows.length;i++) {
        var r=rows[i];
        if (!r.id || r.id === "undefined" || ids[r.id]) throw Error("Premiere did not provide unique clip identities.");
        ids[r.id]=true;
        if (!isFinite(r.start) || !isFinite(r.end) || r.end <= r.start) throw Error("Invalid subtitle duration. Check the timeline.");
        if(i && rows[i-1].end > r.start + psnEpsilon)
            throw Error("Overlapping subtitles already exist on this track. No edits made. Restore the track from a known-good project backup before continuing.");
    }
}
function psnResolve(track, id) {
    var clips=track.clips;
    for(var i=0;i<clips.numItems;i++) if(String(clips[i].nodeId)===id) return clips[i];
    throw Error("A subtitle clip was removed or replaced. No further edits made.");
}
function psnSetTime(clip, field, seconds) {
    if (Math.abs(psnSeconds(clip[field])-seconds)<=psnEpsilon) return;
    var time=new Time(); time.seconds=seconds;
    clip[field]=time;
    if (Math.abs(psnSeconds(clip[field])-seconds)>psnEpsilon) throw Error("Premiere did not apply the subtitle " + field + " exactly.");
}
function psnBounds(track, row) {
    var c=psnResolve(track,row.id);
    // Shrink before expanding to avoid temporarily covering an adjacent subtitle.
    if(row.start > psnSeconds(c.start)) psnSetTime(c,"start",row.start);
    if(row.end < psnSeconds(c.end)) psnSetTime(c,"end",row.end);
    psnSetTime(c,"start",row.start);
    psnSetTime(c,"end",row.end);
}
function psnRestore(track, desired) {
    // First free occupied ranges, then expand into those ranges.
    var i,c,r;
    for(i=0;i<desired.length;i++) {
        r=desired[i]; c=psnResolve(track,r.id);
        if(r.start>psnSeconds(c.start)) { psnSetTime(c,"start",r.start); if(psnSeconds(c.end)>r.end) psnSetTime(c,"end",r.end); }
        if(r.end<psnSeconds(c.end)) psnSetTime(c,"end",r.end);
    }
    for(i=0;i<desired.length;i++) {
        r=desired[i]; psnBounds(track,r); c=psnResolve(track,r.id);
        if(r.inPoint!==undefined) psnSetTime(c,"inPoint",r.inPoint);
        if(r.outPoint!==undefined) psnSetTime(c,"outPoint",r.outPoint);
    }
    if(!psnEqual(psnSnapshot(track),desired)) throw Error("Subtitle restoration could not be verified.");
}
function psnContext(trackIndex) {
    var sequence=app.project.activeSequence;
    if(!sequence) throw Error("Open an active sequence first.");
    var track=psnGetVideoTrack(sequence,trackIndex);
    if(!track) throw Error("Choose an existing video track.");
    var before=psnSnapshot(track);
    psnCheckTrack(track,before);
    if(!before.length) throw Error("No clips are on the selected subtitle track.");
    return { sequence:sequence, track:track, before:before, key:psnSequenceKey(sequence) };
}
function psnApplyEdit(ctx,trackIndex,changes,label) {
    var before=ctx.before, expected=[], i,j;
    for(i=0;i<before.length;i++) {
        var row={}; for(var key in before[i]) row[key]=before[i][key];
        for(j=0;j<changes.length;j++) if(changes[j].id===row.id) { row.start=changes[j].start; row.end=changes[j].end; }
        expected.push(row);
    }
    expected.sort(function(a,b){return a.start-b.start;});
    psnCheckTrack(ctx.track,expected);
    try {
        for(i=0;i<changes.length;i++) psnBounds(ctx.track,changes[i]);
        var after=psnSnapshot(ctx.track);
        // Source in/out may legitimately change on a trim; save the actual values for undo.
        for(i=0;i<expected.length;i++) {
            for(j=0;j<changes.length;j++) if(changes[j].id===expected[i].id) {
                expected[i].inPoint=after[i] && after[i].inPoint;
                expected[i].outPoint=after[i] && after[i].outPoint;
            }
        }
        if(!psnEqual(after,expected)) throw Error("Premiere changed an unexpected clip or boundary.");
        psnCheckTrack(ctx.track,after);
        psnUndoHistory.push({sequenceKey:ctx.key,trackIndex:Number(trackIndex),before:before,after:after,label:label});
        psnRedoHistory=[];
        return after;
    } catch(e) {
        try { psnRestore(ctx.track,before); }
        catch(rollback) { throw Error(e.toString()+" Restoration also failed: "+rollback.toString()+" Stop editing and recover from a project backup."); }
        throw Error(e.toString()+" The previous subtitle state was restored.");
    }
}

function psnGetTrackInfo() {
    try {
        var sequence = app.project.activeSequence;
        if (!sequence) return psnError("Open an active sequence first.");
        return psnJson({ ok: true, trackCount: psnTrackCount(sequence.videoTracks) });
    } catch (e) { return psnError(e.toString()); }
}

function psnGetVideoTrack(sequence, trackIndex) {
    var index = Number(trackIndex);
    var count = psnTrackCount(sequence.videoTracks);
    if (isNaN(index) || index < 0 || index >= count) return null;
    return sequence.videoTracks[index];
}

function psnFindProjectItemByPath(parent, targetPath) {
    if (!parent) return null;
    if (psnNormalizePath(psnProjectItemPath(parent)) === targetPath) return parent;
    var children = null;
    try { children = parent.children; } catch (eChildren) { children = null; }
    if (!children || children.numItems === undefined) return null;
    for (var i = 0; i < children.numItems; i++) {
        var found = psnFindProjectItemByPath(children[i], targetPath);
        if (found) return found;
    }
    return null;
}

function psnCollectProjectItems(parent, map) {
    if (!parent) return;
    var mediaPath = psnNormalizePath(psnProjectItemPath(parent));
    if (mediaPath) map[mediaPath] = parent;
    var children = null;
    try { children = parent.children; } catch (eChildren) { children = null; }
    if (!children || children.numItems === undefined) return;
    for (var i = 0; i < children.numItems; i++) psnCollectProjectItems(children[i], map);
}

function psnGetOrCreateImportBin() {
    var root = app.project.rootItem;
    try {
        for (var i = 0; i < root.children.numItems; i++) {
            var child = root.children[i];
            if (child && child.type === ProjectItemType.BIN && child.name === "Subtitle Navigator Imports") return child;
        }
    } catch (e) {}
    try { return root.createBin("Subtitle Navigator Imports"); } catch (eCreate) { return root; }
}

function psnReadImportPlan(planPath) {
    var file = new File(planPath);
    if (!file.exists) return [];
    file.encoding = "UTF-8";
    if (!file.open("r")) return [];
    var paths = [];
    try {
        while (!file.eof) {
            var line = String(file.readln() || "").replace(/^\uFEFF/, "").replace(/^\s+|\s+$/g, "");
            if (line) paths.push(line);
        }
    } finally { file.close(); }
    return paths;
}

function psnSetProjectItemOneSecond(projectItem) {
    try { projectItem.setInPoint(0, 4); } catch (eIn) {}
    try { projectItem.setOutPoint(1, 4); } catch (eOut) {}
}

function psnImportAll(planPath, trackIndex) {
    try {
        var sequence = app.project.activeSequence;
        if (!sequence) return psnError("Open an active sequence first.");
        var track = psnGetVideoTrack(sequence, trackIndex);
        if (!track) return psnError("Choose an existing video track.");
        var paths = psnReadImportPlan(planPath);
        if (!paths.length) return psnError("The PNG import list is empty.");
        var start = psnSeconds(sequence.getPlayerPosition());
        var existing = psnSnapshot(track);
        psnCheckTrack(track, existing);
        for (var k = 0; k < existing.length; k++) {
            if (existing[k].start < start + paths.length - psnEpsilon && existing[k].end > start + psnEpsilon)
                return psnError("Import would overwrite existing clips. Choose an empty destination range.");
        }

        var itemMap = {};
        psnCollectProjectItems(app.project.rootItem, itemMap);
        var missing = [];
        for (var i = 0; i < paths.length; i++) {
            var normalized = psnNormalizePath(paths[i]);
            if (!itemMap[normalized] && (new File(paths[i])).exists) missing.push(paths[i]);
        }
        if (missing.length) {
            var imported = app.project.importFiles(missing, true, psnGetOrCreateImportBin(), false);
            if (!imported) return psnError("Premiere could not import the subtitle PNG files.");
            itemMap = {};
            psnCollectProjectItems(app.project.rootItem, itemMap);
        }

        var placed = 0;
        for (i = 0; i < paths.length; i++) {
            var item = itemMap[psnNormalizePath(paths[i])];
            if (!item) return psnError("Imported file could not be found in the project: " + paths[i]);
            psnSetProjectItemOneSecond(item);
            track.overwriteClip(item, start + placed);
            placed += 1;
        }
        return psnJson({ ok: true, count: placed, trackIndex: Number(trackIndex), start: start, end: start + placed });
    } catch (e) { return psnError(e.toString()); }
}

function psnValidateSubtitleTrack(trackIndex) {
    try { var ctx=psnContext(trackIndex); return psnJson({ok:true,count:ctx.before.length,trackIndex:Number(trackIndex)}); }
    catch(e) { return psnError(e.toString()); }
}
function psnAdvanceAtPlayhead(trackIndex) {
    try {
        var ctx=psnContext(trackIndex), rows=ctx.before;
        var head=psnSeconds(ctx.sequence.getPlayerPosition()), index=0;
        while(index<rows.length && rows[index].start<=head+psnEpsilon) index++;
        if(index===rows.length) throw Error("No subtitle starts to the right of the playhead.");
        var target=rows[index], left=index ? rows[index-1] : null, changes=[], trimmed=0;
        if(left && left.end>head+psnEpsilon) {
            if(left.start>=head-psnEpsilon) throw Error("Move the playhead inside the current subtitle before advancing.");
            changes.push({id:left.id,start:left.start,end:head}); trimmed=1;
        }
        changes.push({id:target.id,start:head,end:target.end});
        psnApplyEdit(ctx,trackIndex,changes,"Advance subtitle");
        return psnJson({ok:true,name:psnItemName(psnResolve(ctx.track,target.id)),trackIndex:Number(trackIndex),start:head,end:target.end,trimmed:trimmed});
    } catch(e) { return psnError(e.toString()); }
}
function psnPreviousAtPlayhead(trackIndex) {
    try {
        var ctx=psnContext(trackIndex), rows=ctx.before;
        var head=psnSeconds(ctx.sequence.getPlayerPosition()), index=rows.length-1;
        while(index>=0 && rows[index].end>=head-psnEpsilon) index--;
        if(index<0) throw Error("No subtitle ends to the left of the playhead.");
        var target=rows[index], right=index+1<rows.length ? rows[index+1] : null, changes=[], trimmed=0;
        if(right && right.start<head-psnEpsilon) {
            if(right.end<=head+psnEpsilon) throw Error("Move the playhead inside the current subtitle before bringing the previous subtitle.");
            changes.push({id:right.id,start:head,end:right.end}); trimmed=1;
        }
        changes.push({id:target.id,start:target.start,end:head});
        psnApplyEdit(ctx,trackIndex,changes,"Bring previous subtitle");
        return psnJson({ok:true,name:psnItemName(psnResolve(ctx.track,target.id)),trackIndex:Number(trackIndex),start:target.start,end:head,trimmed:trimmed});
    } catch(e) { return psnError(e.toString()); }
}
function psnTrimAtPlayhead(trackIndex,side) {
    try {
        if(side!=="left" && side!=="right") throw Error("Invalid trim side.");
        var ctx=psnContext(trackIndex), head=psnSeconds(ctx.sequence.getPlayerPosition()), row=null;
        for(var i=0;i<ctx.before.length;i++) if(ctx.before[i].start<head-psnEpsilon && ctx.before[i].end>head+psnEpsilon) row=ctx.before[i];
        if(!row) throw Error("Put the playhead inside a subtitle on the chosen track to trim it.");
        var start=side==="left" ? head : row.start, end=side==="right" ? head : row.end;
        psnApplyEdit(ctx,trackIndex,[{id:row.id,start:start,end:end}],"Trim subtitle "+side);
        return psnJson({ok:true,name:psnItemName(psnResolve(ctx.track,row.id)),trackIndex:Number(trackIndex),start:start,end:end});
    } catch(e) { return psnError(e.toString()); }
}
function psnHistoryEdit(trackIndex,redo) {
    try {
        var source=redo ? psnRedoHistory : psnUndoHistory, destination=redo ? psnUndoHistory : psnRedoHistory;
        if(!source.length) throw Error("No subtitle edit to "+(redo ? "redo" : "undo")+". Deactivate subtitle shortcuts to use Premiere's own history.");
        var last=source[source.length-1];
        if(last.kind==="extras") {
            psnExtraHistory(last,trackIndex,redo);
            source.pop(); destination.push(last);
            return psnJson({ok:true,remaining:source.length,label:last.label});
        }
        var ctx=psnContext(trackIndex);
        if(last.sequenceKey!==ctx.key || last.trackIndex!==Number(trackIndex)) throw Error("Return to the sequence and track used for that subtitle edit.");
        var expected=redo ? last.before : last.after, desired=redo ? last.after : last.before;
        if(!psnEqual(ctx.before,expected)) throw Error("The subtitle track changed outside this tool. Undo/redo stopped to avoid overlaps; no clips were changed.");
        try { psnRestore(ctx.track,desired); }
        catch(e) {
            try { psnRestore(ctx.track,expected); }
            catch(rollback) { throw Error("Restoration failed. Stop editing and recover from a project backup. "+rollback.toString()); }
            throw e;
        }
        source.pop(); destination.push(last);
        return psnJson({ok:true,remaining:source.length,label:last.label});
    } catch(e) { return psnError(e.toString()); }
}
function psnUndoLastAdvance(trackIndex) { return psnHistoryEdit(trackIndex,false); }
function psnRedoLastAdvance(trackIndex) { return psnHistoryEdit(trackIndex,true); }

// Extra PNG imports: exact filename families, missing files only, no overwrite.
function psnPngName(path) {
    var name=String(path || "").replace(/\\/g,"/").split("/").pop();
    return /\.png$/i.test(name) ? name.toLowerCase() : "";
}
function psnClipPngName(clip) {
    var path=psnProjectItemPath(clip.projectItem);
    return path ? psnPngName(path) : psnPngName(psnItemName(clip));
}
function psnSequencePngNames(sequence) {
    var seen={};
    for(var t=0;t<sequence.videoTracks.numTracks;t++) {
        var clips=sequence.videoTracks[t].clips;
        for(var i=0;i<clips.numItems;i++) {
            var name=psnClipPngName(clips[i]), path=psnProjectItemPath(clips[i].projectItem);
            if(name) seen[path ? "$"+psnNormalizePath(path) : "@"+name]=true;
        }
    }
    return seen;
}
function psnPlanExtras(paths, originals, seen, occupied, duration) {
    var anchors={}, groups={}, names={}, plan=[], skipped=0, unmatched=0, groupCount=0, i,key;
    for(i=0;i<originals.length;i++) {
        key="$"+psnNormalizePath(originals[i].path);
        if(!anchors[key]) anchors[key]=[];
        anchors[key].push(originals[i]);
    }
    for(i=0;i<paths.length;i++) {
        var name=psnPngName(paths[i]), match=name.match(/^(.*)_([1-9][0-9]*)\.png$/);
        if(!match || !match[1]) continue;
        var normalized=psnNormalizePath(paths[i]);
        if(names["$"+normalized]) continue;
        names["$"+normalized]=true;
        if(seen["$"+normalized] || seen["@"+name]) { skipped++; continue; }
        key="$"+normalized.substring(0,normalized.lastIndexOf("/")+1)+match[1]+".png";
        if(!anchors[key]) { unmatched++; continue; }
        if(anchors[key].length!==1) throw Error("The original appears more than once on the source track: "+match[1]+".png. Choose a track with one original per filename.");
        if(!groups[key]) groups[key]=[];
        groups[key].push({path:paths[i],name:name,variant:Number(match[2])});
    }
    for(key in groups) if(groups.hasOwnProperty(key)) {
        var variants=groups[key], anchor=anchors[key][0];
        variants.sort(function(a,b){return a.variant-b.variant || (a.name<b.name ? -1 : 1);});
        if(!isFinite(anchor.end) || !isFinite(duration) || duration<=0) throw Error("Invalid original subtitle timing.");
        var alignAfter=isFinite(anchor.start) && anchor.end-anchor.start<2-psnEpsilon;
        var start=alignAfter ? anchor.end : anchor.end-variants.length*duration;
        if(start < -psnEpsilon) throw Error("Extra subtitles for "+anchor.name+" would start before the sequence. No clips imported.");
        for(i=0;i<variants.length;i++) plan.push({path:variants[i].path,name:variants[i].name,start:Math.max(0,start+i*duration),end:alignAfter ? start+(i+1)*duration : anchor.end-(variants.length-i-1)*duration,align:alignAfter ? "start" : "end"});
        groupCount++;
    }
    plan.sort(function(a,b){return a.start-b.start;});
    for(i=0;i<plan.length;i++) {
        if(i && plan[i-1].end>plan[i].start+psnEpsilon) throw Error("Extra subtitle groups would overlap. Choose fewer originals on the source track or adjust their timing.");
        for(var j=0;j<occupied.length;j++) if(occupied[j].start<plan[i].end-psnEpsilon && occupied[j].end>plan[i].start+psnEpsilon)
            throw Error("The destination is occupied at "+plan[i].start.toFixed(3)+"s for "+plan[i].name+". Choose an empty track above the originals. No clips imported.");
    }
    return {plan:plan,skipped:skipped,unmatched:unmatched,groups:groupCount};
}
function psnRemoveExtraClips(track, ids) {
    for(var i=ids.length-1;i>=0;i--) {
        var clips=track.clips;
        for(var j=0;j<clips.numItems;j++) if(String(clips[j].nodeId)===ids[i]) { clips[j].remove(false,false); break; }
    }
}
function psnExtraNewIds(track,before) {
    var old={}, ids=[], rows=psnSnapshot(track);
    for(var i=0;i<before.length;i++) old["$"+before[i].id]=true;
    for(i=0;i<rows.length;i++) if(!old["$"+rows[i].id]) ids.push(rows[i].id);
    return ids;
}
function psnExtraRedLabel() {
    // Premiere stores its configurable label colors as packed BGR values.
    // Rose (6) is the red-toned label in the default palette.
    var best=6, distance=Infinity;
    try {
        for(var i=0;i<16;i++) {
            var name=String(app.properties.getProperty("BE.Prefs.LabelNames."+i));
            if(/^red$/i.test(name)) return i;
            var raw=app.properties.getProperty("BE.Prefs.LabelColors."+i);
            if(raw===null || raw===undefined || String(raw)==="") continue;
            var color=Number(raw);
            if(!isFinite(color)) continue;
            var r=color & 255, g=(color >> 8) & 255, b=(color >> 16) & 255;
            if(r<=g || r<=b) continue;
            var d=(255-r)*(255-r)+g*g+b*b;
            if(d<distance) { distance=d; best=i; }
        }
    } catch(ignore) {}
    return best;
}
function psnPlaceExtras(track,plan,before) {
    var map={}; psnCollectProjectItems(app.project.rootItem,map);
    var missing=[], i;
    for(i=0;i<plan.length;i++) {
        if(!(new File(plan[i].path)).exists) throw Error("PNG is missing: "+plan[i].path);
        if(!map[psnNormalizePath(plan[i].path)]) missing.push(plan[i].path);
    }
    if(missing.length) {
        if(!app.project.importFiles(missing,true,psnGetOrCreateImportBin(),false)) throw Error("Premiere could not import the extra PNG files.");
        map={}; psnCollectProjectItems(app.project.rootItem,map);
    }
    // Verify every source item before any timeline placements.
    for(i=0;i<plan.length;i++) {
        var item=map[psnNormalizePath(plan[i].path)];
        if(!item) throw Error("Cannot find imported PNG: "+plan[i].name);
    }
    var placed=[], actualPlacements=[], redLabel=psnExtraRedLabel();
    try {
        for(i=0;i<plan.length;i++) {
            var p=plan[i], source=map[psnNormalizePath(p.path)];
            var previous=psnSnapshot(track);
            // Never trust source PNG marks to determine inserted still duration.
            // Import beyond every existing/planned destination clip, where even a
            // long default still duration cannot overwrite anything.
            var frame=Number(app.project.activeSequence.timebase)/254016000000;
            if(!isFinite(frame) || frame<=0) throw Error("Cannot read sequence frame duration.");
            var tail=p.end;
            for(var t=0;t<previous.length;t++) tail=Math.max(tail,previous[t].end);
            for(t=0;t<plan.length;t++) tail=Math.max(tail,plan[t].end);
            var stagingStart=(Math.ceil(tail/frame)+2)*frame;
            // Newly inserted timeline instances inherit the project item's label.
            source.setColorLabel(redLabel);
            if(Number(source.getColorLabel())!==redLabel) throw Error("Premiere could not set the extra subtitle label color.");
            track.overwriteClip(source,stagingStart);
            var ids=psnExtraNewIds(track,previous);
            if(ids.length!==1) throw Error("Premiere did not place exactly one extra subtitle.");
            var clip=psnResolve(track,ids[0]);
            if(psnNormalizePath(psnProjectItemPath(clip.projectItem))!==psnNormalizePath(p.path))
                throw Error("Premiere inserted an unexpected PNG.");
            var actualStart=psnSeconds(clip.start);
            if(actualStart<tail-psnEpsilon) throw Error("Premiere did not insert the PNG in the empty staging area.");
            var requestedDuration=p.end-p.start;
            try { psnSetTime(clip,"end",actualStart+requestedDuration); }
            catch(resizeError) {
                // Some reused stills cannot extend beyond their available range.
                // Accept only a valid shorter clip; keep its planned alignment edge.
            }
            clip=psnResolve(track,ids[0]);
            var availableDuration=psnSeconds(clip.end)-psnSeconds(clip.start);
            if(Math.abs(psnSeconds(clip.start)-actualStart)>psnEpsilon || !isFinite(availableDuration) ||
                availableDuration<frame-psnEpsilon || availableDuration>requestedDuration+psnEpsilon)
                throw Error("Premiere could not give the extra subtitle a valid duration at or below the requested length: "+p.name);
            var alignedStart=p.align==="start" ? p.start : p.end-availableDuration;
            var alignedEnd=p.align==="start" ? p.start+availableDuration : p.end;
            var offset=new Time(); offset.seconds=alignedStart-actualStart;
            if(!clip.move) throw Error("Premiere does not support moving the newly imported subtitle.");
            clip.move(offset);
            clip=psnResolve(track,ids[0]);
            if(psnNormalizePath(psnProjectItemPath(clip.projectItem))!==psnNormalizePath(p.path) || Math.abs(psnSeconds(clip.start)-alignedStart)>psnEpsilon || Math.abs(psnSeconds(clip.end)-alignedEnd)>psnEpsilon)
                throw Error("Premiere placed an extra subtitle at an unexpected time.");
            placed.push(ids[0]);
            actualPlacements.push({start:alignedStart,end:alignedEnd,shortened:availableDuration<requestedDuration-psnEpsilon || p.shortened===true});
            var after=psnSnapshot(track), kept=[];
            for(var k=0;k<after.length;k++) if(after[k].id!==ids[0]) kept.push(after[k]);
            if(!psnEqual(kept,previous)) throw Error("Premiere changed an existing destination clip.");
            psnCheckTrack(track,after);
        }
        // Store actual spans only after the whole batch succeeds, so redo keeps
        // the accepted shorter lengths and failed retries cannot alter history.
        for(i=0;i<plan.length;i++) { plan[i].start=actualPlacements[i].start; plan[i].end=actualPlacements[i].end; plan[i].shortened=actualPlacements[i].shortened; }
        return placed;
    } catch(e) {
        try {
            psnRemoveExtraClips(track,psnExtraNewIds(track,before));
            if(!psnEqual(psnSnapshot(track),before)) throw Error("Existing destination clips changed.");
        } catch(rollback) { throw Error(e.toString()+" Import rollback could not be verified: "+rollback.toString()+" Stop and check the timeline."); }
        throw Error(e.toString()+" New timeline clips were removed; project-bin imports may remain.");
    }
}
function psnFindExtraPaths(originals) {
    var folders={}, paths=[];
    for(var i=0;i<originals.length;i++) {
        var path=originals[i].path;
        if(!path) throw Error("Cannot locate the source PNG for "+originals[i].name+". Relink it in Premiere first.");
        var folder=(new File(path)).parent, key="$"+psnNormalizePath(folder.fsName);
        if(folders[key]) continue;
        folders[key]=true;
        if(!folder.exists) throw Error("Subtitle folder is unavailable: "+folder.fsName);
        var files=folder.getFiles();
        if(!files) throw Error("Could not read subtitle folder: "+folder.fsName);
        for(var j=0;j<files.length;j++) if(files[j] instanceof File && /_[1-9][0-9]*\.png$/i.test(files[j].fsName)) paths.push(files[j].fsName);
    }
    return paths;
}
function psnImportExtras(sourceIndex,destinationIndex,sourceIds) {
    try {
        var seq=app.project.activeSequence;
        if(!seq) throw Error("Open an active sequence first.");
        var detectSource=sourceIndex===undefined, automatic=destinationIndex===undefined;
        if(detectSource) sourceIndex=psnDetectSubtitleTrack(seq);
        if(automatic) destinationIndex=Number(sourceIndex)+1;
        sourceIndex=Number(sourceIndex); destinationIndex=Number(destinationIndex);
        if(sourceIndex%1 || destinationIndex%1 || destinationIndex<=sourceIndex) throw Error("Choose an existing destination track above the original subtitle track.");
        var source=psnGetVideoTrack(seq,sourceIndex), dest=psnGetVideoTrack(seq,destinationIndex);
        if(!source || (!automatic && !dest)) throw Error("Choose existing source and destination video tracks.");
        var before=automatic ? [] : psnSnapshot(dest);
        if(!automatic) psnCheckTrack(dest,before);
        var originals=[], clips=source.clips;
        for(var i=0;i<clips.numItems;i++) {
            var name=psnClipPngName(clips[i]);
            if(name && (!sourceIds || sourceIds["$"+clips[i].nodeId]) && (!detectSource || psnIsSubtitleName(name))) originals.push({name:name,path:psnProjectItemPath(clips[i].projectItem),start:psnSeconds(clips[i].start),end:psnSeconds(clips[i].end)});
        }
        var frame=Number(seq.timebase)/254016000000;
        if(!isFinite(frame) || frame<=0) throw Error("Could not read the sequence frame rate.");
        var duration=Math.max(1,Math.round(1/frame))*frame;
        var result=psnPlanExtras(psnFindExtraPaths(originals),originals,psnSequencePngNames(seq),before,duration);
        if(!result.plan.length) return psnJson({ok:true,count:0,skipped:result.skipped,unmatched:result.unmatched,groups:0,trackIndex:destinationIndex,sourceIndex:sourceIndex});
        if(automatic) dest=psnCreateExtraTrack(seq,sourceIndex);
        var ids=psnPlaceExtras(dest,result.plan,before);
        psnUndoHistory.push({kind:"extras",sequenceKey:psnSequenceKey(seq),trackIndex:sourceIndex,destinationIndex:destinationIndex,before:before,after:psnSnapshot(dest),ids:ids,plan:result.plan,label:"Import and align extra subtitles"});
        psnRedoHistory=[];
        var shortened=0;
        for(i=0;i<result.plan.length;i++) if(result.plan[i].shortened) shortened++;
        return psnJson({ok:true,count:ids.length,skipped:result.skipped,unmatched:result.unmatched,groups:result.groups,trackIndex:destinationIndex,duration:duration,shortened:shortened,sourceIndex:sourceIndex});
    } catch(e) { return psnError(e.toString()); }
}
function psnExtraHistory(last,trackIndex,redo) {
    var seq=app.project.activeSequence;
    if(!seq || psnSequenceKey(seq)!==last.sequenceKey || Number(trackIndex)!==last.trackIndex)
        throw Error("Return to the sequence and original subtitle track used for this import.");
    var track=psnGetVideoTrack(seq,last.destinationIndex);
    if(!track) throw Error("The extra subtitle track no longer exists.");
    var current=psnSnapshot(track); psnCheckTrack(track,current);
    if(!psnEqual(current,redo ? last.before : last.after)) throw Error("The extra subtitle track changed outside this operation. Undo/redo stopped without changing clips.");
    if(redo) {
        var seen=psnSequencePngNames(seq);
        for(var i=0;i<last.plan.length;i++) if(seen["$"+psnNormalizePath(last.plan[i].path)] || seen["@"+last.plan[i].name]) throw Error("An extra subtitle is already in the sequence. Redo stopped to avoid duplicates.");
        var newIds=psnPlaceExtras(track,last.plan,last.before), idMap={};
        for(i=0;i<last.ids.length;i++) idMap["$"+last.ids[i]]=newIds[i];
        // Later redone timing edits must refer to the recreated clips' new IDs.
        var histories=[psnUndoHistory,psnRedoHistory];
        for(var h=0;h<histories.length;h++) for(var r=0;r<histories[h].length;r++) {
            var record=histories[h][r];
            if(record.sequenceKey!==last.sequenceKey) continue;
            var snapshots=[record.before,record.after];
            for(var s=0;s<snapshots.length;s++) for(var j=0;j<snapshots[s].length;j++) {
                var row=snapshots[s][j]; if(idMap["$"+row.id]) row.id=idMap["$"+row.id];
            }
        }
        last.ids=newIds; last.after=psnSnapshot(track);
    } else {
        try { psnRemoveExtraClips(track,last.ids); }
        catch(e) {
            // Preserve a retryable record if the host removed only part of the batch.
            last.after=psnSnapshot(track);
            throw Error("Extra-subtitle undo was interrupted. Check the timeline before retrying. "+e.toString());
        }
        if(!psnEqual(psnSnapshot(track),last.before)) throw Error("Could not verify removal of the extra subtitles.");
    }
}


var psnExtraDetection=null;
function psnDetectExtraSource() {
    psnExtraDetection=null;
    try {
        var seq=app.project.activeSequence;
        if(!seq) throw Error("Open an active sequence first.");
        var seen=psnSequencePngNames(seq), best=null, tied=false;
        for(var t=0;t<seq.videoTracks.numTracks;t++) {
            var clips=seq.videoTracks[t].clips, groups={};
            for(var c=0;c<clips.numItems;c++) {
                var name=psnClipPngName(clips[c]), match=/^(.*?)([0-9]{3,})(?:_([1-9][0-9]*))?\.png$/i.exec(name);
                if(!match) continue;
                var media=psnNormalizePath(psnProjectItemPath(clips[c].projectItem));
                if(match[3] && (seen["$"+media.replace(/_[1-9][0-9]*\.png$/i,".png")] || seen["@"+name.replace(/_[1-9][0-9]*\.png$/i,".png")])) continue;
                var key="$"+match[1].toLowerCase();
                if(!groups[key]) groups[key]=[];
                groups[key].push({id:clips[c].nodeId,number:Number(match[2]),start:psnSeconds(clips[c].start),name:name});
            }
            var count=0, ids={}, first="", last="";
            for(var key in groups) {
                if(!groups.hasOwnProperty(key)) continue;
                var rows=groups[key];
                if(rows.length<3) continue;
                rows.sort(function(a,b){return a.start-b.start;});
                var direction=0, ordered=true;
                for(var i=1;i<rows.length;i++) {
                    var delta=rows[i].number-rows[i-1].number, sign=delta>0 ? 1 : delta<0 ? -1 : 0;
                    if(!sign || (direction && sign!==direction)) { ordered=false; break; }
                    direction=sign;
                }
                if(!ordered) continue;
                if(!first) first=rows[0].name;
                last=rows[rows.length-1].name;
                count+=rows.length;
                for(i=0;i<rows.length;i++) ids["$"+rows[i].id]=true;
            }
            if(count && (!best || count>best.count)) { best={sourceIndex:t,count:count,ids:ids,first:first,last:last}; tied=false; }
            else if(best && count===best.count) tied=true;
        }
        if(!best) throw Error("No clear subtitle track found. Need at least three PNGs with the same name prefix and increasing or decreasing trailing numbers (3 or more digits). Choose the subtitle track manually.");
        if(tied) throw Error("Multiple tracks have the same number of matching subtitles. Choose the subtitle track manually.");
        psnExtraDetection={sequenceKey:psnSequenceKey(seq),sourceIndex:best.sourceIndex,ids:best.ids,snapshot:psnSnapshot(seq.videoTracks[best.sourceIndex])};
        return psnJson({ok:true,sourceIndex:best.sourceIndex,count:best.count,first:best.first,last:best.last});
    } catch(e) { return psnError(e.toString()); }
}
function psnImportDetectedExtras() {
    try {
        var detection=psnExtraDetection, seq=app.project.activeSequence;
        psnExtraDetection=null;
        if(!detection || !seq || psnSequenceKey(seq)!==detection.sequenceKey ||
            !psnGetVideoTrack(seq,detection.sourceIndex) || !psnEqual(psnSnapshot(seq.videoTracks[detection.sourceIndex]),detection.snapshot))
            throw Error("The sequence or subtitle track changed after detection. Detect and confirm again.");
        return psnImportExtras(detection.sourceIndex,undefined,detection.ids);
    } catch(e) { return psnError(e.toString()); }
}
function psnIsSubtitleName(name) {
    return /^fn\s+(?:teaser\s+)?\d+\s*-\s*\d+(?:_[1-9][0-9]*)?\.png$/i.test(name);
}
function psnDetectSubtitleTrack(sequence) {
    var seen=psnSequencePngNames(sequence), found=[];
    for(var t=0;t<sequence.videoTracks.numTracks;t++) {
        var clips=sequence.videoTracks[t].clips, hasOriginal=false;
        for(var c=0;c<clips.numItems;c++) {
            var name=psnClipPngName(clips[c]);
            if(!psnIsSubtitleName(name)) continue;
            var path=psnNormalizePath(psnProjectItemPath(clips[c].projectItem));
            // Existing variants above a present base are extras, not a second source track.
            var base=name.replace(/_[1-9][0-9]*\.png$/i,".png");
            var basePath=path.replace(/_[1-9][0-9]*\.png$/i,".png");
            if(base!==name && (seen["$"+basePath] || seen["@"+base])) continue;
            hasOriginal=true;
        }
        if(hasOriginal) found.push(t);
    }
    if(!found.length) throw Error("No subtitle track found. Expected FN 3289-0514.png or FN TEASER 3289 -0045.png-style names.");
    if(found.length>1) {
        var labels=[]; for(var i=0;i<found.length;i++) labels.push("V"+(found[i]+1));
        throw Error("Subtitles are on multiple tracks ("+labels.join(", ")+"). Put all original subtitles on one track, then import again. Nothing imported.");
    }
    return found[0];
}
function psnInsertedTrackIndex(sequence,before,ids,audioCount) {
    var tracks=sequence.videoTracks, count=before.length, found=-1;
    if(tracks.numTracks!==count+1 || (sequence.audioTracks && sequence.audioTracks.numTracks!==audioCount)) return -1;
    for(var candidate=0;candidate<=count;candidate++) {
        if(tracks[candidate].clips.numItems!==0) continue;
        var matches=true;
        for(var i=0;i<count;i++) {
            var shifted=i>=candidate ? i+1 : i;
            if(!psnEqual(before[i],psnSnapshot(tracks[shifted])) ||
                (ids[i]!==undefined && String(ids[i])!==String(tracks[shifted].id))) { matches=false; break; }
        }
        if(matches) { if(found!==-1) return -1; found=candidate; }
    }
    return found;
}
function psnRemoveVerifiedNewTrack(sequence,qeSequence,index,before,ids,audioCount) {
    // Never remove an existing track or use removeEmptyVideoTracks: only the
    // single new empty track whose insertion preserved every original track.
    if(!qeSequence.removeVideoTrack || psnInsertedTrackIndex(sequence,before,ids,audioCount)!==index)
        throw Error("Cannot safely correct the new track position. No extras imported; check the track layout.");
    qeSequence.removeVideoTrack(index);
    var tracks=sequence.videoTracks;
    if(tracks.numTracks!==before.length || (sequence.audioTracks && sequence.audioTracks.numTracks!==audioCount))
        throw Error("Could not restore the original track layout. No extras imported.");
    for(var i=0;i<before.length;i++) {
        if(!psnEqual(before[i],psnSnapshot(tracks[i])) || (ids[i]!==undefined && String(ids[i])!==String(tracks[i].id)))
            throw Error("Could not verify the restored track layout. No extras imported.");
    }
}
function psnCreateExtraTrack(sequence,sourceIndex) {
    var tracks=sequence.videoTracks, count=tracks.numTracks, before=[], ids=[], i;
    var audioCount=sequence.audioTracks ? sequence.audioTracks.numTracks : 0;
    for(i=0;i<count;i++) { before.push(psnSnapshot(tracks[i])); ids.push(tracks[i].id); }
    if(!app.enableQE) throw Error("This Premiere version cannot create the extra subtitle track automatically.");
    app.enableQE();
    var qeSequence=qe.project.getActiveSequence();
    if(!qeSequence || !qeSequence.addTracks) throw Error("Premiere did not expose track creation. No extras imported.");
    var destinationIndex=sourceIndex+1;
    // Request the insertion slot above the source. QE versions differ in
    // whether this argument is an insertion slot or an 'after track' index.
    var insertionArgument=destinationIndex;
    qeSequence.addTracks(1,insertionArgument,0);
    var actualIndex=psnInsertedTrackIndex(sequence,before,ids,audioCount);
    if(actualIndex<0) throw Error("Premiere changed the track order unexpectedly. No extras imported; check the track layout.");
    if(actualIndex!==destinationIndex) {
        psnRemoveVerifiedNewTrack(sequence,qeSequence,actualIndex,before,ids,audioCount);
        insertionArgument+=destinationIndex-actualIndex;
        qeSequence.addTracks(1,insertionArgument,0);
        actualIndex=psnInsertedTrackIndex(sequence,before,ids,audioCount);
        if(actualIndex!==destinationIndex) {
            if(actualIndex>=0) psnRemoveVerifiedNewTrack(sequence,qeSequence,actualIndex,before,ids,audioCount);
            throw Error("Premiere could not create a track directly above V"+(sourceIndex+1)+". No extras imported.");
        }
    }
    tracks=sequence.videoTracks;
    if(tracks[destinationIndex].clips.numItems!==0) throw Error("The new track is not empty or not directly above the subtitles. No extras imported.");
    for(i=0;i<count;i++) {
        var shifted=i>=destinationIndex ? i+1 : i;
        if(!psnEqual(before[i],psnSnapshot(tracks[shifted])) ||
            (ids[i]!==undefined && String(ids[i])!==String(tracks[shifted].id)))
            throw Error("Premiere changed the track order unexpectedly. No extras imported; check the track layout.");
    }
    // Existing history still refers to the same tracks after inserting above the source.
    var histories=[psnUndoHistory,psnRedoHistory], sequenceKey=psnSequenceKey(sequence);
    for(var h=0;h<histories.length;h++) for(i=0;i<histories[h].length;i++) {
        var record=histories[h][i];
        if(record.sequenceKey!==sequenceKey) continue;
        if(record.trackIndex>=destinationIndex) record.trackIndex++;
        if(record.destinationIndex!==undefined && record.destinationIndex>=destinationIndex) record.destinationIndex++;
    }
    return tracks[destinationIndex];
}
