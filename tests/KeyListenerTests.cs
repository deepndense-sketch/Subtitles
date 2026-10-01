using System;
internal class KeyListenerTests
{
    public static int Main()
    {
        Check(0x25,false,false,false,false,"left");
        Check(0xDB,false,false,false,false,"trim-left");
        Check(0xDD,false,false,false,false,"trim-right");
        Check(0x4C,false,false,false,false,null);
        Check(0x52,false,false,false,false,null);
        Check(0xDB,true,false,false,false,null);
        Check(0xDD,false,true,false,false,null);
        Check(0x5A,true,false,false,false,"undo");
        Check(0x5A,true,true,false,false,"redo");
        Check(0x4C,true,false,false,false,null);
        Check(0x52,false,true,false,false,null);
        Check(0x25,false,false,true,false,null);
        Check(0x5A,true,false,true,false,null);
        Check(0x5A,true,false,false,true,null);
        Check(0x27,false,false,false,false,"right");
        Check(0x27,true,false,false,false,null);
        Check(0x27,false,true,false,false,null);
        Check(0x27,false,false,true,false,null);
        foreach(int key in new int[]{0x25,0x26,0x27,0x28,0x20,0xDB,0xDD,0xA2,0xA3,0xA0,0xA1})
            Keep(key,false,false,false,false,true);
        Keep(0x5A,true,false,false,false,true);
        Keep(0x5A,true,true,false,false,true);
        foreach(int key in new int[]{0x41,0x4C,0x52,0x1B,0x0D,0x09,0x70,0xA4,0xA5,0x5B,0x5C})
            Keep(key,false,false,false,false,false);
        Keep(0x53,true,false,false,false,false);
        Keep(0x20,true,false,false,false,false);
        Keep(0x25,false,false,true,false,false);
        Console.WriteLine("shortcut mapping and automatic deactivation tests passed"); return 0;
    }
    static void Check(int key, bool ctrl, bool shift, bool alt, bool win, string expected)
    {
        if(KeyListener.CommandForKey(key,ctrl,shift,alt,win)!=expected) throw new Exception("Incorrect shortcut mapping");
    }
    static void Keep(int key, bool ctrl, bool shift, bool alt, bool win, bool expected)
    {
        if(KeyListener.KeepsShortcutsActive(key,ctrl,shift,alt,win)!=expected) throw new Exception("Incorrect deactivation for key " + key);
    }
}
